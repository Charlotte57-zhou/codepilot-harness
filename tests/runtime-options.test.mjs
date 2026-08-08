import test from "node:test";
import assert from "node:assert/strict";
import { createRuntimeOptions } from "../src/runtime-options.mjs";

test("RuntimeOptions freezes one canonical per-run policy", () => {
  const options = createRuntimeOptions({
    runId: "run-1",
    workspaceRoot: ".",
    settingSources: ["project"],
    permissionMode: "auto",
    budgets: { maxTurns: 20, maxRetries: 3, deadlineMs: 60_000, maxOutputTokens: 4_096, compactionOutputTokens: 1_000 },
    model: { provider: "deepseek", name: "model", capabilities: { toolCalling: true }, reasoning: { enabled: true, effort: "max", supportedEfforts: ["high", "max"], thinkingMode: "adaptive" } }
  });
  assert.equal(options.permissionMode, "auto");
  assert.equal(options.budgets.maxTurns, 20);
  assert.equal(Object.isFrozen(options), true);
  assert.equal(Object.isFrozen(options.budgets), true);
  assert.deepEqual(options.model.reasoning, { enabled: true, effort: "max", supportedEfforts: ["high", "max"], thinkingMode: "adaptive", budgetTokens: null });
  assert.throws(() => { options.budgets.maxTurns = 99; }, TypeError);
});

test("RuntimeOptions rejects implicit or invalid settings sources", () => {
  assert.throws(() => createRuntimeOptions({
    runId: "run-1",
    workspaceRoot: ".",
    settingSources: ["machine"],
    budgets: { maxTurns: 1, maxRetries: 1, deadlineMs: 1, maxOutputTokens: 1, compactionOutputTokens: 1 }
  }), /settingSources/);
});
