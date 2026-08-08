import { normalizeAttachmentRecord } from "./attachment-protocol.mjs";

function toolCallFromEvent(event) {
  const data = event.data ?? {};
  if (!data.toolCallId || !data.tool) return null;
  return { id: data.toolCallId, name: data.tool, input: data.input ?? {} };
}

function resultFromEvent(event) {
  const data = event.data ?? {};
  if (!data.toolCallId || typeof data.content !== "string") return null;
  return { role: "tool", toolCallId: data.toolCallId, content: data.content };
}

/**
 * Projects append-only session events into the provider-neutral conversation
 * protocol. It deliberately excludes system prompts: they are rebuilt from
 * current runtime configuration, project memory, and the current task.
 */
export function projectTranscript(events = []) {
  const messages = [];
  const callsByTurn = new Map();
  const reasoningByTurn = new Map();
  const emittedTurns = new Set();
  const knownCalls = new Map();
  const results = new Map();
  const attachments = new Map();
  const diagnostics = [];
  let latestTask = "";
  let latestState = "idle";
  let latestRunId = null;
  const runs = new Map();
  const sessionEventTypes = new Set(["session_started", "session_renamed", "journal_tail_repaired", "session_index_refresh_failed"]);
  const runFor = (runId) => {
    const run = runs.get(runId) ?? { id: runId, task: "", state: "preparing", terminal: false, completionRecorded: false, eventCount: 0 };
    run.eventCount += 1;
    runs.set(runId, run);
    latestRunId = runId;
    return run;
  };
  const addCall = (runId, turn, toolCall) => {
    if (!toolCall) return;
    const key = `${runId}:${turn}`;
    const calls = callsByTurn.get(key) ?? [];
    if (!calls.some((call) => call.id === toolCall.id)) calls.push(toolCall);
    callsByTurn.set(key, calls);
    knownCalls.set(toolCall.id, toolCall);
  };

  const emitAssistantToolTurn = (runId, turn) => {
    const key = `${runId}:${turn}`;
    if (emittedTurns.has(key)) return;
    const toolCalls = callsByTurn.get(key) ?? [];
    if (!toolCalls.length) return;
    messages.push({ role: "assistant", content: reasoningByTurn.get(key) ?? "", toolCalls });
    emittedTurns.add(key);
  };

  for (const event of events) {
    const data = event.data ?? {};
    if (sessionEventTypes.has(event.type)) continue;
    if (typeof data.runId !== "string" || !data.runId) {
      diagnostics.push({ code: "RUN_ID_REQUIRED", eventId: event.id, eventType: event.type });
      continue;
    }
    const runId = data.runId;
    const run = runFor(runId);
    if (event.type === "attachment_added") {
      const attachment = normalizeAttachmentRecord(data.attachment);
      if (!attachment) diagnostics.push({ code: "INVALID_ATTACHMENT_EVENT", eventId: event.id });
      else attachments.set(attachment.id, attachment);
      continue;
    }
    if (event.type === "user_message" && typeof data.content === "string") {
      const attachmentIds = Array.isArray(data.attachmentIds) ? data.attachmentIds : [];
      const resolvedAttachments = attachmentIds.map((id) => attachments.get(id)).filter(Boolean);
      messages.push({ role: "user", content: data.content, ...(resolvedAttachments.length ? { attachments: resolvedAttachments } : {}) });
      latestTask = data.content;
      run.task = data.content;
      continue;
    }
    if (event.type === "tool_call_ready") {
      addCall(runId, data.turn ?? 0, toolCallFromEvent(event));
      continue;
    }
    if (event.type === "agent_reasoning" && typeof data.summary === "string") {
      reasoningByTurn.set(`${runId}:${data.turn ?? 0}`, data.summary);
      continue;
    }
    if (event.type === "tool_requested") {
      const turn = data.turn ?? 0;
      addCall(runId, turn, toolCallFromEvent(event));
      emitAssistantToolTurn(runId, turn);
      continue;
    }
    if (event.type === "tool_result_recorded" || event.type === "tool_result_repaired") {
      const result = resultFromEvent(event);
      if (!result) {
        diagnostics.push({ code: "INVALID_TOOL_RESULT_EVENT", eventId: event.id });
        continue;
      }
      if (results.has(result.toolCallId)) {
        diagnostics.push({ code: "DUPLICATE_TOOL_RESULT", toolCallId: result.toolCallId, eventId: event.id });
        continue;
      }
      results.set(result.toolCallId, result);
      messages.push(result);
      continue;
    }
    if (event.type === "agent_final" && typeof data.summary === "string") {
      messages.push({ role: "assistant", content: data.summary });
      run.terminal = true;
      run.completionRecorded = true;
      continue;
    }
    if (event.type === "agent_status" || event.type === "run_state_changed") {
      latestState = data.to ?? data.state ?? latestState;
      run.state = latestState;
      if (["failed", "cancelled"].includes(latestState)) run.terminal = true;
    }
    if (event.type === "supervisor_run_orphaned") {
      latestState = "orphaned";
      run.state = "orphaned";
      run.terminal = true;
    }
    if (event.type === "agent_final") run.terminal = true;
    if (event.type === "agent_error") { run.state = "failed"; run.terminal = true; }
  }

  // The current protocol keeps requests pending until an explicit result event
  // arrives; recovery owns the only repair path for interrupted calls.
  for (const key of callsByTurn.keys()) {
    const [runId, turn] = key.split(":");
    emitAssistantToolTurn(runId, turn);
  }
  const pendingToolCalls = [...knownCalls.values()].filter((toolCall) => !results.has(toolCall.id));
  return { messages, pendingToolCalls, latestTask, latestState, latestRunId, runs: [...runs.values()], diagnostics, lastEventId: events.at(-1)?.id ?? null };
}

export function validateTranscript(projection) {
  const violations = [...projection.diagnostics];
  const assistantCalls = new Map();
  const toolResults = new Map();
  for (const message of projection.messages) {
    if (message.role === "assistant") {
      for (const toolCall of message.toolCalls ?? []) {
        if (assistantCalls.has(toolCall.id)) violations.push({ code: "DUPLICATE_TOOL_CALL", toolCallId: toolCall.id });
        assistantCalls.set(toolCall.id, toolCall);
      }
    }
    if (message.role === "tool") {
      if (!assistantCalls.has(message.toolCallId)) violations.push({ code: "ORPHAN_TOOL_RESULT", toolCallId: message.toolCallId });
      if (toolResults.has(message.toolCallId)) violations.push({ code: "DUPLICATE_TOOL_RESULT", toolCallId: message.toolCallId });
      toolResults.set(message.toolCallId, message);
    }
  }
  const missingToolResults = [...assistantCalls.values()].filter((toolCall) => !toolResults.has(toolCall.id));
  for (const run of projection.runs ?? []) {
    if (run.state === "completed" && !run.completionRecorded) {
      violations.push({ code: "COMPLETED_RUN_MISSING_FINAL", runId: run.id });
    }
  }
  return {
    valid: violations.length === 0 && missingToolResults.length === 0,
    repairable: violations.length === 0 && missingToolResults.length > 0,
    violations,
    missingToolResults
  };
}
