import test from "node:test";
import assert from "node:assert/strict";

import {
  defaultRuntimeBudgets,
  normalizeRuntimeBudgets,
  resolveRunBudgetPolicy,
  runtimeBudgetsFromEnvironment
} from "../src/runtime-budget-policy.mjs";

test("runtime budget policy has practical agent defaults and bounded user input", () => {
  assert.deepEqual(defaultRuntimeBudgets, {
    maxTurns: 24,
    maxRetries: 2,
    deadlineMs: 600_000,
    maxOutputTokens: 8_192,
    compactionOutputTokens: 1_000
  });
  assert.deepEqual(normalizeRuntimeBudgets({
    maxTurns: 500,
    maxRetries: -4,
    deadlineMs: 1,
    maxOutputTokens: 999_999,
    compactionOutputTokens: 12
  }), {
    maxTurns: 100,
    maxRetries: 0,
    deadlineMs: 60_000,
    maxOutputTokens: 65_536,
    compactionOutputTokens: 256
  });
});

test("provider capability clamps output without rewriting the requested policy", () => {
  const policy = resolveRunBudgetPolicy({
    maxTurns: 30,
    maxRetries: 3,
    deadlineMs: 900_000,
    maxOutputTokens: 16_384,
    compactionOutputTokens: 2_000
  }, { maxOutputTokens: 4_096 });
  assert.equal(policy.requestedMaxOutputTokens, 16_384);
  assert.equal(policy.providerMaxOutputTokens, 4_096);
  assert.equal(policy.maxOutputTokens, 4_096);
  assert.equal(policy.compactionOutputTokens, 2_000);
  assert.equal(policy.outputClamped, true);
});

test("environment defaults use the same validation path as persisted settings", () => {
  assert.deepEqual(runtimeBudgetsFromEnvironment({
    CODEPILOT_MAX_TURNS: "40",
    CODEPILOT_MAX_RETRIES: "4",
    CODEPILOT_RUN_DEADLINE_MS: "1200000",
    CODEPILOT_MAX_OUTPUT_TOKENS: "12288",
    CODEPILOT_COMPACTION_OUTPUT_TOKENS: "1536"
  }), {
    maxTurns: 40,
    maxRetries: 4,
    deadlineMs: 1_200_000,
    maxOutputTokens: 12_288,
    compactionOutputTokens: 1_536
  });
});

