import test from "node:test";
import assert from "node:assert/strict";
import { buildRunViewModels } from "../public/run-view-model.js";

const event = (id, type, timestamp, data) => ({ id, type, timestamp, data });

test("RunViewModel keeps separate runs in one session and derives metrics from durable events", () => {
  const runs = buildRunViewModels([
    event("1", "run_state_changed", "2026-07-13T10:00:00.000Z", { runId: "run-a", to: "sampling", turn: 1, retries: 0, maxTurns: 12, maxRetries: 2, deadlineMs: 300000, remainingMs: 300000 }),
    event("2", "tool_completed", "2026-07-13T10:00:02.000Z", { runId: "run-a", toolCallId: "read-1" }),
    event("3", "tool_result_recorded", "2026-07-13T10:00:03.000Z", { runId: "run-a", toolCallId: "read-1" }),
    event("4", "context_compacted", "2026-07-13T10:00:04.000Z", { runId: "run-a", afterEstimatedTokens: 812 }),
    event("5", "run_state_changed", "2026-07-13T10:00:05.000Z", { runId: "run-a", to: "completed", turn: 1, retries: 0, maxTurns: 12, maxRetries: 2, deadlineMs: 300000, remainingMs: 295000 }),
    event("6", "run_state_changed", "2026-07-13T10:01:00.000Z", { runId: "run-b", to: "sampling", turn: 1, retries: 0, maxTurns: 12, maxRetries: 2, deadlineMs: 300000, remainingMs: 300000 }),
    event("7", "run_budget_warning", "2026-07-13T10:01:02.000Z", { runId: "run-b", kind: "turns", message: "任务接近运行上限，正在收敛结果。" })
  ], { now: () => new Date("2026-07-13T10:01:04.000Z").getTime() });

  const [first, second] = runs;
  assert.equal(first.runId, "run-a");
  assert.equal(first.isTerminal, true);
  assert.equal(first.toolResultCount, 1);
  assert.equal(first.compactCount, 1);
  assert.equal(first.contextTokens, 812);
  assert.equal(first.elapsedMs, 5000);
  assert.equal(second.runId, "run-b");
  assert.equal(second.isTerminal, false);
  assert.equal(second.budgetWarning.message, "任务接近运行上限，正在收敛结果。");
});

test("RunViewModel requires the current terminal state event", () => {
  const [run] = buildRunViewModels([
    event("1", "user_message", "2026-07-13T10:00:00.000Z", { runId: "current-run", content: "Explain the project" }),
    event("2", "agent_final", "2026-07-13T10:00:03.000Z", { runId: "current-run", summary: "Done" })
  ], { now: () => new Date("2026-07-13T10:00:10.000Z").getTime() });

  assert.equal(run.state, "preparing");
  assert.equal(run.isTerminal, false);
  assert.equal(run.elapsedMs, 10000);
});

test("RunViewModel treats a process-restart orphan as a terminal historical run", () => {
  const [run] = buildRunViewModels([
    event("1", "run_state_changed", "2026-07-13T10:00:00.000Z", { runId: "orphan", to: "streaming" }),
    event("2", "supervisor_run_orphaned", "2026-07-13T10:00:05.000Z", { runId: "orphan", reason: "process_restart" })
  ], { now: () => new Date("2026-07-13T11:00:00.000Z").getTime() });

  assert.equal(run.state, "orphaned");
  assert.equal(run.isTerminal, true);
  assert.equal(run.endedAt, "2026-07-13T10:00:05.000Z");
  assert.equal(run.elapsedMs, 5000);
});
