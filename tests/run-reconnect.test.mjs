import test from "node:test";
import assert from "node:assert/strict";
import { deriveRunAttachment } from "../public/run-reconnect.js";

test("a renderer reload reattaches polling to a server-owned active run", () => {
  const events = [
    { type: "session_started", data: {} },
    { type: "user_message", data: { runId: "run-1" } },
    { type: "run_state_changed", data: { runId: "run-1", to: "streaming" } }
  ];
  assert.deepEqual(deriveRunAttachment(events, { latestRunId: "run-1", running: true }), {
    latestRunId: "run-1",
    runStartEventCount: 1,
    running: true
  });
});

test("a terminal fact prevents stale session metadata from restarting polling", () => {
  const events = [
    { type: "user_message", data: { runId: "run-1" } },
    { type: "agent_final", data: { runId: "run-1" } }
  ];
  assert.equal(deriveRunAttachment(events, { latestRunId: "run-1", running: true }).running, false);
});
