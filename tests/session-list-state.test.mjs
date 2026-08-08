import test from "node:test";
import assert from "node:assert/strict";
import { projectSessionListState } from "../src/session-list-state.mjs";
import {
  baselineSeenTerminalEventIds,
  countUnreadCompletions,
  deriveSessionAttention,
  persistSeenTerminalEventIds,
  restoreSeenTerminalEventIds
} from "../public/session-attention.js";

test("session list projection follows only the latest run", () => {
  const events = [
    { id: "old-final", type: "agent_final", data: { runId: "old" } },
    { id: "new-user", type: "user_message", data: { runId: "new" } },
    { id: "new-state", type: "run_state_changed", data: { runId: "new", to: "executing_tools" } }
  ];
  assert.deepEqual(projectSessionListState(events), {
    latestRunId: "new",
    latestRunState: "executing_tools",
    latestTerminalEventId: null,
    latestOutcome: null
  });
});

test("agent final is the durable completion attention identity", () => {
  const projected = projectSessionListState([
    { id: "user", type: "user_message", data: { runId: "run" } },
    { id: "state", type: "run_state_changed", data: { runId: "run", to: "completed" } },
    { id: "final", type: "agent_final", data: { runId: "run" } }
  ]);
  assert.equal(projected.latestOutcome, "completed");
  assert.equal(projected.latestTerminalEventId, "final");
});

test("process-restart orphan is terminal in the latest-run projection", () => {
  const projected = projectSessionListState([
    { id: "user", type: "user_message", data: { runId: "run" } },
    { id: "state", type: "run_state_changed", data: { runId: "run", to: "streaming" } },
    { id: "orphan", type: "supervisor_run_orphaned", data: { runId: "run", reason: "process_restart" } }
  ]);
  assert.equal(projected.latestRunState, "orphaned");
  assert.equal(projected.latestOutcome, "orphaned");
  assert.equal(projected.latestTerminalEventId, "orphan");
});

test("running wins over unread and completion becomes idle after acknowledgement", () => {
  const session = { running: false, latestOutcome: "completed", latestTerminalEventId: "final" };
  const seen = new Set();
  assert.equal(deriveSessionAttention({ ...session, running: true }, seen), "running");
  assert.equal(deriveSessionAttention(session, seen), "completed_unread");
  seen.add("final");
  assert.equal(deriveSessionAttention(session, seen), "idle");
});

test("desktop unread count and receipts are bounded deterministic projections", () => {
  const sessions = [
    { latestOutcome: "completed", latestTerminalEventId: "a" },
    { latestOutcome: "completed", latestTerminalEventId: "b" },
    { latestOutcome: "failed", latestTerminalEventId: "c" }
  ];
  const restored = restoreSeenTerminalEventIds(persistSeenTerminalEventIds(new Set(["a"])));
  assert.equal(countUnreadCompletions(sessions, restored), 1);
});

test("first-use baseline treats historical terminal events as already seen", () => {
  const baseline = baselineSeenTerminalEventIds([
    { latestTerminalEventId: "terminal-old-1" },
    { latestTerminalEventId: null },
    { latestTerminalEventId: "terminal-old-2" }
  ], new Set(["terminal-existing"]));

  assert.deepEqual([...baseline], ["terminal-existing", "terminal-old-1", "terminal-old-2"]);
});
