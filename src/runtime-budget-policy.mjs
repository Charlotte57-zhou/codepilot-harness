export const runtimeBudgetLimits = Object.freeze({
  maxTurns: Object.freeze({ min: 4, max: 100 }),
  maxRetries: Object.freeze({ min: 0, max: 8 }),
  deadlineMs: Object.freeze({ min: 60_000, max: 3_600_000 }),
  maxOutputTokens: Object.freeze({ min: 256, max: 65_536 }),
  compactionOutputTokens: Object.freeze({ min: 256, max: 8_192 })
});

export const defaultRuntimeBudgets = Object.freeze({
  maxTurns: 24,
  maxRetries: 2,
  deadlineMs: 600_000,
  maxOutputTokens: 8_192,
  compactionOutputTokens: 1_000
});

function boundedInteger(value, fallback, limits) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(limits.min, Math.min(limits.max, parsed));
}

export function normalizeRuntimeBudgets(input = {}, fallback = defaultRuntimeBudgets) {
  return Object.freeze({
    maxTurns: boundedInteger(input.maxTurns, fallback.maxTurns, runtimeBudgetLimits.maxTurns),
    maxRetries: boundedInteger(input.maxRetries, fallback.maxRetries, runtimeBudgetLimits.maxRetries),
    deadlineMs: boundedInteger(input.deadlineMs, fallback.deadlineMs, runtimeBudgetLimits.deadlineMs),
    maxOutputTokens: boundedInteger(input.maxOutputTokens, fallback.maxOutputTokens, runtimeBudgetLimits.maxOutputTokens),
    compactionOutputTokens: boundedInteger(
      input.compactionOutputTokens,
      fallback.compactionOutputTokens,
      runtimeBudgetLimits.compactionOutputTokens
    )
  });
}

export function runtimeBudgetsFromEnvironment(env = process.env) {
  return normalizeRuntimeBudgets({
    maxTurns: env.CODEPILOT_MAX_TURNS,
    maxRetries: env.CODEPILOT_MAX_RETRIES,
    deadlineMs: env.CODEPILOT_RUN_DEADLINE_MS,
    maxOutputTokens: env.CODEPILOT_MAX_OUTPUT_TOKENS,
    compactionOutputTokens: env.CODEPILOT_COMPACTION_OUTPUT_TOKENS
  });
}

export function resolveRunBudgetPolicy(requested, modelCapabilities = {}) {
  const normalized = normalizeRuntimeBudgets(requested);
  const providerMaxOutputTokens = Number.isInteger(modelCapabilities.maxOutputTokens) && modelCapabilities.maxOutputTokens > 0
    ? modelCapabilities.maxOutputTokens
    : defaultRuntimeBudgets.maxOutputTokens;
  const maxOutputTokens = Math.min(normalized.maxOutputTokens, providerMaxOutputTokens);
  return Object.freeze({
    ...normalized,
    requestedMaxOutputTokens: normalized.maxOutputTokens,
    providerMaxOutputTokens,
    maxOutputTokens,
    compactionOutputTokens: Math.min(normalized.compactionOutputTokens, maxOutputTokens),
    outputClamped: maxOutputTokens !== normalized.maxOutputTokens
  });
}

