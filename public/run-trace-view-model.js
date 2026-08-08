import { buildLineDiff } from "./file-change-view-model.js";
import { summarizeActivityOperations } from "./activity-grammar.js";
import { presentActivityOperation } from "./activity-presenter.js";
import { projectTaskProgressReferences } from "./task-reference-projector.js";

function byTime(left, right) {
  return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
}

function toolBatchId(event) {
  return typeof event.data?.batchId === "string" && event.data.batchId ? event.data.batchId : null;
}

function changeKind(change) {
  if (change?.operation === "create" || change?.before?.exists === false) return "create";
  if (change?.operation === "delete" || change?.after?.exists === false) return "delete";
  return "edit";
}

function operationStatus(completion) {
  if (!completion) return "running";
  if (completion.type === "tool_cancelled") return "cancelled";
  if (completion.data?.error?.code === "PERMISSION_DENIED") return "declined";
  if (completion.data?.error?.code === "BASH_COMMAND_NOT_ALLOWLISTED") return "not_run";
  return completion.data?.ok === false ? "failed" : "completed";
}

function projectOperation(execution) {
  const { request, completion } = execution;
  const tool = request.data?.tool ?? "Tool";
  const status = operationStatus(completion);
  const started = new Date(request.timestamp).getTime();
  const ended = completion ? new Date(completion.timestamp).getTime() : null;
  const executionDuration = completion?.data?.metadata?.execution?.durationMs;
  const changes = execution.fileChanges?.length
    ? execution.fileChanges
    : [completion?.data?.metadata?.fileChange, ...(completion?.data?.metadata?.fileChanges ?? [])].filter(Boolean);
  const files = changes.map((change) => {
    const rows = buildLineDiff(change.before?.content ?? "", change.after?.content ?? "");
    return {
      path: change.path,
      changeKind: changeKind(change),
      additions: rows.filter((row) => row.kind === "addition").length,
      deletions: rows.filter((row) => row.kind === "deletion").length
    };
  });
  const input = request.data?.input ?? {};
  const operation = presentActivityOperation({
    id: request.data?.toolCallId ?? request.id,
    runId: request.data?.runId,
    tool,
    status,
    startedAt: request.timestamp,
    endedAt: completion?.timestamp ?? null,
    durationMs: Number.isFinite(executionDuration)
      ? executionDuration
      : ended == null || !Number.isFinite(started) || !Number.isFinite(ended) ? null : Math.max(0, ended - started),
    durationSource: Number.isFinite(executionDuration) ? "execution" : "observed",
    input,
    files,
    sourceEventIds: [request.id, completion?.id, ...(execution.mutationEventIds ?? [])].filter(Boolean),
    sourcePresentation: completion?.data?.presentation ?? request.data?.presentation ?? null,
    descriptor: request.data?.activity ?? null
  });
  operation.kind = operation.family === "exploration" ? "inspect" : operation.family;
  if (operation.command) {
    operation.command.exitCode = completion?.data?.metadata?.execution?.exitCode ?? completion?.data?.metadata?.exitCode ?? null;
  }
  return operation;
}

export function summarizeToolExecutions(executions = []) {
  const operations = executions.map((execution) => execution.operation ?? projectOperation(execution));
  const summary = summarizeActivityOperations(operations);
  const completed = executions.filter(({ completion }) => completion).length;
  return { ...summary, completed };
}

function mergeAdjacentToolBatches(activities) {
  const merged = [];
  for (const activity of activities) {
    const previous = merged.at(-1);
    if (activity.kind !== "tool_batch" || previous?.kind !== "tool_batch") {
      merged.push(activity);
      continue;
    }
    previous.executions.push(...activity.executions);
    previous.endedAt = activity.endedAt;
    previous.sourceBatchIds.push(activity.batchId);
    for (const execution of previous.executions) execution.operation ??= projectOperation(execution);
    previous.label = summarizeToolExecutions(previous.executions).label;
  }
  return merged;
}

/**
 * Deterministically projects durable run events into a compact conversation
 * trace. Raw events remain available in replay; this projection owns grouping,
 * streaming progress replacement, and tool protocol presentation.
 */
export function buildRunTraceViewModel(events, { live = false, todo = null } = {}) {
  const ordered = [...events].sort(byTime);
  const finalizedReasoningTurns = new Set(
    ordered.filter((event) => event.type === "agent_reasoning").map((event) => event.data?.turn)
  );
  const streamedByTurn = new Map();
  const batches = new Map();
  const mutationEvents = [];
  const activities = [];

  const ensureBatch = (event) => {
    const batchId = toolBatchId(event);
    if (!batchId) return null;
    const current = batches.get(batchId) ?? {
      kind: "tool_batch",
      batchId,
      label: event.data?.presentation?.label,
      startedAt: event.timestamp,
      endedAt: null,
      executions: [],
      order: ordered.indexOf(event),
      sourceBatchIds: [batchId]
    };
    if (event.data?.presentation?.label) current.label = event.data.presentation.label;
    batches.set(batchId, current);
    return current;
  };

  ordered.forEach((event, order) => {
    if (event.type === "model_text_delta") {
      const turn = event.data?.turn ?? 0;
      const current = streamedByTurn.get(turn) ?? { text: "", order };
      current.text += event.data?.text ?? "";
      current.order = order;
      streamedByTurn.set(turn, current);
      return;
    }
    if (event.type === "agent_reasoning") {
      activities.push({
        kind: "reasoning",
        text: projectTaskProgressReferences(event.data?.summary ?? "", todo),
        streaming: false,
        order
      });
      return;
    }
    if (event.type === "model_attempt_failed" || event.type === "model_retry_scheduled") {
      activities.push({ kind: "retry", event, order });
      return;
    }
    if (event.type === "run_budget_warning" || event.type === "run_budget_exceeded") {
      activities.push({ kind: "notice", event, order });
      return;
    }
    if (event.type === "context_compacted") {
      activities.push({ kind: "compact", event, order });
      return;
    }
    if (event.type === "tool_batch_started") {
      const batch = ensureBatch(event);
      if (!batch) return;
      batch.order = order;
      return;
    }
    if (event.type === "tool_requested") {
      const batch = ensureBatch(event);
      if (!batch) return;
      batch.executions.push({ request: event, completion: undefined });
      return;
    }
    if (event.type === "tool_completed" || event.type === "tool_cancelled") {
      const execution = [...batches.values()]
        .flatMap((batch) => batch.executions)
        .find((candidate) => candidate.request.data?.toolCallId === event.data?.toolCallId);
      if (execution) execution.completion = event;
      return;
    }
    if (event.type === "tool_batch_completed") {
      const batch = ensureBatch(event);
      if (!batch) return;
      batch.endedAt = event.timestamp;
      return;
    }
    if (event.type === "workspace_mutation_observed") mutationEvents.push(event);
  });

  for (const event of mutationEvents) {
    const sourceIds = new Set(event.data?.sourceToolCallIds ?? []);
    for (const [index, change] of (event.data?.fileChanges ?? []).entries()) {
      const candidates = [...batches.values()].flatMap((batch) => batch.executions)
        .filter((execution) => sourceIds.has(execution.request.data?.toolCallId));
      const normalizedPath = String(change.path ?? "").replaceAll("\\", "/").toLowerCase();
      const matching = candidates.filter((execution) => {
        const inputPath = execution.request.data?.input?.file_path ?? execution.request.data?.input?.path;
        return inputPath && String(inputPath).replaceAll("\\", "/").toLowerCase().endsWith(normalizedPath);
      });
      const target = matching.length === 1 ? matching[0] : candidates.length === 1 ? candidates[0] : null;
      if (target) {
        (target.fileChanges ??= []).push(change);
        (target.mutationEventIds ??= []).push(event.id);
        continue;
      }
      const batchId = `workspace:${event.id ?? event.timestamp}`;
      const batch = batches.get(batchId) ?? {
        kind: "tool_batch",
        batchId,
        label: null,
        startedAt: event.timestamp,
        endedAt: event.timestamp,
        executions: [],
        order: ordered.indexOf(event),
        sourceBatchIds: [batchId]
      };
      const syntheticId = `${batchId}:${index}`;
      batch.executions.push({
        request: {
          id: syntheticId,
          type: "tool_requested",
          timestamp: event.timestamp,
          data: {
            runId: event.data?.runId,
            tool: "WorkspaceMutation",
            toolCallId: syntheticId,
            input: { path: change.path },
            presentation: { title: "文件修改", detail: change.path }
          }
        },
        completion: {
          id: event.id,
          type: "tool_completed",
          timestamp: event.timestamp,
          data: { runId: event.data?.runId, tool: "WorkspaceMutation", toolCallId: syntheticId, ok: true }
        },
        fileChanges: [change],
        mutationEventIds: [event.id]
      });
      batches.set(batchId, batch);
    }
  }

  for (const batch of batches.values()) {
    if (batch.executions.length) activities.push(batch);
  }
  const finalAnswerTurn = !live && ordered.some((event) => event.type === "agent_final")
    ? [...streamedByTurn.keys()].at(-1)
    : null;
  for (const [turn, streamed] of streamedByTurn) {
    if (!finalizedReasoningTurns.has(turn) && streamed.text.trim() && (live || turn !== finalAnswerTurn)) {
      activities.push({
        kind: "reasoning",
        text: projectTaskProgressReferences(streamed.text, todo),
        streaming: live,
        order: streamed.order
      });
    }
  }

  activities.sort((left, right) => left.order - right.order);
  const merged = mergeAdjacentToolBatches(activities);
  for (const activity of merged) {
    if (activity.kind === "tool_batch") {
      for (const execution of activity.executions) execution.operation = projectOperation(execution);
      activity.label = summarizeToolExecutions(activity.executions).label;
    }
  }
  return { activities: merged };
}
