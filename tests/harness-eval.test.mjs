import test from "node:test";
import assert from "node:assert/strict";
import { evaluateHarnessEvents } from "../src/harness-eval.mjs";

test("Harness Eval detects a final answer that escaped its completion gate", () => {
  const report = evaluateHarnessEvents([
    { type: "runtime_options_frozen", data: { runId: "escaped", deliveryContract: { artifact: { kind: "workspace_change" } } } },
    { type: "run_state_changed", data: { runId: "escaped", to: "completed" } },
    { type: "agent_final", data: { runId: "escaped" } },
    { type: "runtime_options_frozen", data: { runId: "good", deliveryContract: { artifact: { kind: "workspace_change" } } } },
    { type: "completion_gate_evaluated", data: { runId: "good", accepted: true } },
    { type: "run_state_changed", data: { runId: "good", to: "completed" } },
    { type: "agent_final", data: { runId: "good" } }
  ]);
  assert.equal(report.completedCount, 2);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.contractMissingCount, 0);
  assert.equal(report.completionEscapeCount, 1);
  assert.deepEqual(report.escapeRunIds, ["escaped"]);
});

test("Harness Eval counts a run without the current DeliveryContract as invalid", () => {
  const report = evaluateHarnessEvents([
    { type: "run_state_changed", data: { runId: "missing-contract", to: "completed" } },
    { type: "agent_final", data: { runId: "missing-contract" } }
  ]);
  assert.equal(report.contractMissingCount, 1);
  assert.deepEqual(report.contractMissingRunIds, ["missing-contract"]);
  assert.equal(report.completionEscapeCount, 1);
});
