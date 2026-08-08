import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, createSession, deleteSession, getEvents } from "../src/session-store.mjs";
import { recoverSessionTranscript } from "../src/session-recovery.mjs";
import { projectTranscript, validateTranscript } from "../src/transcript-projector.mjs";

const event = (type, data = {}) => ({ id: `${type}-${Math.random()}`, type, timestamp: new Date().toISOString(), data: { runId: "run-current", ...data } });

test("TranscriptProjector rebuilds a completed tool conversation from protocol events", () => {
  const projection = projectTranscript([
    event("user_message", { content: "Read README.md" }),
    event("tool_call_ready", { turn: 1, tool: "Read", toolCallId: "read-1", input: { path: "README.md" } }),
    event("agent_reasoning", { turn: 1, summary: "I will inspect README.md." }),
    event("tool_requested", { turn: 1, tool: "Read", toolCallId: "read-1", input: { path: "README.md" } }),
    event("tool_result_recorded", { turn: 1, tool: "Read", toolCallId: "read-1", content: JSON.stringify({ ok: true, content: "# Demo" }) }),
    event("agent_status", { state: "completed" }),
    event("agent_final", { summary: "README.md contains the demo overview." })
  ]);

  assert.deepEqual(projection.messages.map((message) => message.role), ["user", "assistant", "tool", "assistant"]);
  assert.deepEqual(projection.messages[1].toolCalls, [{ id: "read-1", name: "Read", input: { path: "README.md" } }]);
  assert.equal(projection.messages[2].toolCallId, "read-1");
  assert.equal(validateTranscript(projection).valid, true);
});

test("TranscriptProjector restores uploaded attachments as first-class user-message data", () => {
  const projection = projectTranscript([
    event("attachment_added", { attachment: { id: "att-1", name: "notes.txt", mediaType: "text/plain", origin: "upload", content: "Attachment fact" } }),
    event("user_message", { content: "Summarize this file", attachmentIds: ["att-1"] })
  ]);

  assert.equal(projection.latestTask, "Summarize this file");
  assert.equal(projection.messages[0].content, "Summarize this file");
  assert.deepEqual(projection.messages[0].attachments, [{
    id: "att-1", name: "notes.txt", kind: "text", mediaType: "text/plain", origin: "upload", content: "Attachment fact", charCount: 15, byteSize: 15, estimatedTokens: 4
  }]);
});

test("resume recovery repairs an interrupted tool call from JSONL before building messages", async () => {
  const session = await createSession("Transcript recovery test", { workspaceTargetId: "target-0123456789abcdef" });
  try {
    await appendEvent(session.id, "user_message", { content: "Read README.md", runId: "run-current" });
    await appendEvent(session.id, "tool_requested", { turn: 1, tool: "Read", toolCallId: "read-1", input: { path: "README.md" }, runId: "run-current" });
    await appendEvent(session.id, "agent_status", { state: "executing_tools", runId: "run-current" });

    const recovered = await recoverSessionTranscript(session.id);
    const resultEvent = (await getEvents(session.id)).find((item) => item.type === "tool_result_repaired");
    const toolMessage = recovered.projection.messages.find((message) => message.role === "tool");

    assert.equal(recovered.validation.valid, true);
    assert.equal(resultEvent.data.toolCallId, "read-1");
    assert.equal(JSON.parse(toolMessage.content).error.code, "TOOL_CANCELLED");
    assert.equal(recovered.projection.messages.at(-1).role, "tool");
  } finally {
    await deleteSession(session.id);
  }
});

test("tool display events do not replace the current explicit result contract", () => {
  const projection = projectTranscript([
    event("user_message", { content: "Read README.md" }),
    event("tool_requested", { turn: 1, tool: "Read", toolCallId: "read-1", input: { path: "README.md" } }),
    event("tool_completed", { turn: 1, tool: "Read", toolCallId: "read-1", ok: true, summary: "Read 10 characters" }),
    event("agent_status", { state: "completed" }),
    event("agent_final", { summary: "Done" })
  ]);
  assert.equal(projection.messages.some((message) => message.role === "tool"), false);
  assert.equal(validateTranscript(projection).repairable, true);
});

test("runId keeps two turn-one tool calls in one session from being merged", () => {
  const projection = projectTranscript([
    event("user_message", { runId: "run-a", content: "Read A" }),
    event("tool_requested", { runId: "run-a", turn: 1, tool: "Read", toolCallId: "read-a", input: { path: "A.md" } }),
    event("tool_result_recorded", { runId: "run-a", tool: "Read", toolCallId: "read-a", content: JSON.stringify({ ok: true, content: "A" }) }),
    event("agent_status", { runId: "run-a", state: "completed" }),
    event("agent_final", { runId: "run-a", summary: "A done" }),
    event("user_message", { runId: "run-b", content: "Read B" }),
    event("tool_requested", { runId: "run-b", turn: 1, tool: "Read", toolCallId: "read-b", input: { path: "B.md" } }),
    event("tool_result_recorded", { runId: "run-b", tool: "Read", toolCallId: "read-b", content: JSON.stringify({ ok: true, content: "B" }) }),
    event("agent_status", { runId: "run-b", state: "completed" }),
    event("agent_final", { runId: "run-b", summary: "B done" })
  ]);

  assert.equal(projection.runs.length, 2);
  assert.equal(projection.latestRunId, "run-b");
  assert.deepEqual(projection.messages.filter((message) => message.role === "assistant" && message.toolCalls).map((message) => message.toolCalls[0].id), ["read-a", "read-b"]);
  assert.equal(validateTranscript(projection).valid, true);
});

test("transcript projection closes a run orphaned by process restart", () => {
  const projection = projectTranscript([
    event("user_message", { runId: "run", content: "Continue" }),
    event("run_state_changed", { runId: "run", state: "streaming" }),
    event("supervisor_run_orphaned", { runId: "run", reason: "process_restart" })
  ]);
  assert.equal(projection.latestState, "orphaned");
  assert.equal(projection.runs[0].terminal, true);
});
