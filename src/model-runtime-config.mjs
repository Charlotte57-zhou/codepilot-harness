import { loadPersistedRuntimeConfig, persistRuntimeConfig } from "./secret-store.mjs";
import {
  clearAllProviderCredentials,
  clearProviderCredential,
  getConfiguredProviderIds,
  getProviderCredential,
  initializeProviderCredentialVault,
  reloadProviderCredentialVault,
  persistProviderCredential
} from "./provider-credential-vault.mjs";
import { normalizeRuntimeBudgets, runtimeBudgetsFromEnvironment } from "./runtime-budget-policy.mjs";
import { normalizeAnthropicProviderId, resolveAnthropicProviderProfile } from "./anthropic-provider-profile.mjs";
import { resolveModelCapabilities, resolveModelReasoning } from "./provider-catalog.mjs";

const defaultRuntimeConfig = Object.freeze({
  provider: normalizeAnthropicProviderId(process.env.MODEL_PROVIDER || "anthropic"),
  baseUrl: process.env.MODEL_BASE_URL ?? "",
  model: process.env.MODEL_NAME ?? "",
  apiKey: process.env.MODEL_API_KEY ?? "",
  thinkingEnabled: process.env.MODEL_THINKING_ENABLED !== "false",
  reasoningEffort: process.env.MODEL_REASONING_EFFORT ?? "high",
  budgets: runtimeBudgetsFromEnvironment()
});

const runtimeConfig = { ...defaultRuntimeConfig, budgets: { ...defaultRuntimeConfig.budgets } };
let configMutationQueue = Promise.resolve();

function resolvedDraft(draft) {
  const profile = resolveAnthropicProviderProfile(draft);
  const reasoning = resolveModelReasoning(profile.id, profile.model);
  return {
    ...draft,
    provider: profile.id,
    baseUrl: profile.baseUrl,
    model: profile.model,
    reasoningEffort: reasoning.supported && !reasoning.efforts.includes(draft.reasoningEffort)
      ? reasoning.defaultEffort
      : draft.reasoningEffort,
    budgets: normalizeRuntimeBudgets(draft.budgets, runtimeConfig.budgets)
  };
}

function commitRuntimeConfig(next) {
  Object.assign(runtimeConfig, next, { budgets: { ...next.budgets } });
}

function enqueueConfigMutation(operation) {
  const queued = configMutationQueue.catch(() => {}).then(operation);
  configMutationQueue = queued;
  return queued;
}

export async function initializeModelRuntimeConfig() {
  const persisted = await loadPersistedRuntimeConfig();
  const draft = { ...runtimeConfig, budgets: { ...runtimeConfig.budgets } };
  if (!process.env.MODEL_PROVIDER && persisted.provider) draft.provider = persisted.provider;
  draft.provider = normalizeAnthropicProviderId(draft.provider);
  if (!process.env.MODEL_BASE_URL && persisted.baseUrl) draft.baseUrl = persisted.baseUrl;
  if (!process.env.MODEL_NAME && persisted.model) draft.model = persisted.model;
  if (process.env.MODEL_THINKING_ENABLED === undefined && typeof persisted.thinkingEnabled === "boolean") draft.thinkingEnabled = persisted.thinkingEnabled;
  if (!process.env.MODEL_REASONING_EFFORT && ["high", "max"].includes(persisted.reasoningEffort)) draft.reasoningEffort = persisted.reasoningEffort;
  const persistedBudgets = normalizeRuntimeBudgets(persisted.budgets, draft.budgets);
  draft.budgets = normalizeRuntimeBudgets({
    ...persistedBudgets,
    ...(process.env.CODEPILOT_MAX_TURNS !== undefined ? { maxTurns: draft.budgets.maxTurns } : {}),
    ...(process.env.CODEPILOT_MAX_RETRIES !== undefined ? { maxRetries: draft.budgets.maxRetries } : {}),
    ...(process.env.CODEPILOT_RUN_DEADLINE_MS !== undefined ? { deadlineMs: draft.budgets.deadlineMs } : {}),
    ...(process.env.CODEPILOT_MAX_OUTPUT_TOKENS !== undefined ? { maxOutputTokens: draft.budgets.maxOutputTokens } : {}),
    ...(process.env.CODEPILOT_COMPACTION_OUTPUT_TOKENS !== undefined ? { compactionOutputTokens: draft.budgets.compactionOutputTokens } : {})
  }, draft.budgets);

  await initializeProviderCredentialVault();
  if (!process.env.MODEL_API_KEY) draft.apiKey = getProviderCredential(draft.provider);
  commitRuntimeConfig(resolvedDraft(draft));
}

export function reloadModelRuntimeConfig() {
  return enqueueConfigMutation(async () => {
    const persisted = await loadPersistedRuntimeConfig();
    const draft = { ...defaultRuntimeConfig, budgets: { ...defaultRuntimeConfig.budgets } };
    if (!process.env.MODEL_PROVIDER && persisted.provider) draft.provider = persisted.provider;
    draft.provider = normalizeAnthropicProviderId(draft.provider);
    if (!process.env.MODEL_BASE_URL && persisted.baseUrl) draft.baseUrl = persisted.baseUrl;
    if (!process.env.MODEL_NAME && persisted.model) draft.model = persisted.model;
    if (process.env.MODEL_THINKING_ENABLED === undefined && typeof persisted.thinkingEnabled === "boolean") draft.thinkingEnabled = persisted.thinkingEnabled;
    if (!process.env.MODEL_REASONING_EFFORT && ["high", "max"].includes(persisted.reasoningEffort)) draft.reasoningEffort = persisted.reasoningEffort;
    draft.budgets = normalizeRuntimeBudgets(persisted.budgets, draft.budgets);
    await reloadProviderCredentialVault();
    if (!process.env.MODEL_API_KEY) draft.apiKey = getProviderCredential(draft.provider);
    commitRuntimeConfig(resolvedDraft(draft));
    return getPublicModelConfig();
  });
}

export function getModelEnvironment() {
  return {
    ...process.env,
    MODEL_PROVIDER: runtimeConfig.provider,
    MODEL_BASE_URL: runtimeConfig.baseUrl,
    MODEL_NAME: runtimeConfig.model,
    MODEL_API_KEY: runtimeConfig.apiKey,
    MODEL_THINKING_ENABLED: String(runtimeConfig.thinkingEnabled),
    MODEL_REASONING_EFFORT: runtimeConfig.reasoningEffort
  };
}

export function getPublicModelConfig() {
  const capabilities = resolveModelCapabilities(runtimeConfig.provider, runtimeConfig.model);
  const reasoning = resolveModelReasoning(runtimeConfig.provider, runtimeConfig.model);
  return {
    provider: runtimeConfig.provider,
    baseUrl: runtimeConfig.baseUrl,
    model: runtimeConfig.model,
    thinkingEnabled: runtimeConfig.thinkingEnabled,
    reasoningEffort: runtimeConfig.reasoningEffort,
    effectiveReasoning: {
      supported: reasoning.supported,
      enabled: capabilities.reasoning && runtimeConfig.thinkingEnabled,
      effort: reasoning.supported ? runtimeConfig.reasoningEffort : null,
      efforts: reasoning.efforts,
      thinkingMode: reasoning.thinkingMode,
      budgetTokens: reasoning.budgetTokens
    },
    budgets: { ...runtimeConfig.budgets },
    hasApiKey: Boolean(runtimeConfig.apiKey),
    configuredProviders: getConfiguredProviderIds()
  };
}

export function updateModelConfig(input = {}) {
  return enqueueConfigMutation(async () => {
    const previousProvider = runtimeConfig.provider;
    const requestedProvider = input.provider === undefined
      ? previousProvider
      : normalizeAnthropicProviderId(input.provider);
    const providerChanged = requestedProvider !== previousProvider;
    const draft = {
      ...runtimeConfig,
      provider: requestedProvider,
      baseUrl: input.baseUrl !== undefined ? String(input.baseUrl).trim() : providerChanged ? "" : runtimeConfig.baseUrl,
      model: input.model !== undefined ? String(input.model).trim() : providerChanged ? "" : runtimeConfig.model,
      thinkingEnabled: input.thinkingEnabled !== undefined ? input.thinkingEnabled !== false : runtimeConfig.thinkingEnabled,
      reasoningEffort: ["high", "max"].includes(input.reasoningEffort) ? input.reasoningEffort : runtimeConfig.reasoningEffort,
      budgets: input.budgets && typeof input.budgets === "object"
        ? normalizeRuntimeBudgets(input.budgets, runtimeConfig.budgets)
        : { ...runtimeConfig.budgets },
      apiKey: providerChanged ? getProviderCredential(requestedProvider) : runtimeConfig.apiKey
    };
    const next = resolvedDraft(draft);

    if (input.clearApiKey === true) {
      await clearProviderCredential(next.provider);
      next.apiKey = "";
    } else if (input.apiKey) {
      next.apiKey = String(input.apiKey);
      await persistProviderCredential(next.provider, next.apiKey);
    }

    await persistRuntimeConfig(next);
    commitRuntimeConfig(next);
    return getPublicModelConfig();
  });
}

export function resetModelConfig() {
  return enqueueConfigMutation(async () => {
    const next = resolvedDraft({ ...defaultRuntimeConfig, budgets: { ...defaultRuntimeConfig.budgets } });
    await clearAllProviderCredentials();
    await persistRuntimeConfig(next);
    commitRuntimeConfig(next);
    return getPublicModelConfig();
  });
}
