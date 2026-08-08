// Public entries are limited to providers with an official Anthropic-compatible
// Messages/Claude Code endpoint. Capability flags describe the selected transport,
// not every model the vendor offers through other protocols.
const textOnlyCapabilities = {
  contextWindowTokens: 128_000,
  maxOutputTokens: 8_000,
  safetyBufferTokens: 4_000,
  input: { text: true, image: false, pdf: false },
  toolCalling: true,
  reasoning: false,
  promptCache: { mode: "none", enabled: false, reportsUsage: false }
};

const reasoning = { supported: true, efforts: ["high", "max"], defaultEnabled: true, defaultEffort: "high", thinkingMode: "adaptive" };
const basicReasoning = { supported: false, efforts: [], defaultEnabled: false, defaultEffort: "high", thinkingMode: "none" };
const manualReasoning = { supported: false, efforts: [], defaultEnabled: true, defaultEffort: "high", thinkingMode: "enabled", budgetTokens: 8_192 };

export const providerCatalog = {
  anthropic: {
    label: "Anthropic Claude",
    anthropicCompatible: true,
    authMode: "api_key",
    modelsEndpoint: "https://api.anthropic.com/v1/models",
    baseUrls: [{ label: "Anthropic API", value: "https://api.anthropic.com" }],
    models: ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
    defaultCapabilities: {
      ...textOnlyCapabilities,
      contextWindowTokens: 200_000,
      safetyBufferTokens: 8_000,
      input: { text: true, image: true, pdf: true },
      promptCache: { mode: "explicit", enabled: true, reportsUsage: true }
    },
    modelCapabilities: {
      "claude-sonnet-4-6": { contextWindowTokens: 1_000_000, maxOutputTokens: 64_000 },
      "claude-opus-4-6": { contextWindowTokens: 1_000_000, maxOutputTokens: 128_000 },
      "claude-haiku-4-5": { contextWindowTokens: 200_000, maxOutputTokens: 64_000 }
    },
    reasoning,
    modelReasoning: {
      // Haiku 4.5 can think, but it does not implement the API effort control.
      "claude-haiku-4-5": manualReasoning
    }
  },
  deepseek: {
    label: "DeepSeek",
    anthropicCompatible: true,
    authMode: "auth_token",
    baseUrls: [{ label: "DeepSeek Anthropic API", value: "https://api.deepseek.com/anthropic" }],
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],
    defaultCapabilities: { ...textOnlyCapabilities, contextWindowTokens: 1_000_000, maxOutputTokens: 384_000, safetyBufferTokens: 16_000, reasoning: true, promptCache: { mode: "automatic", enabled: true, reportsUsage: true } },
    reasoning
  },
  moonshot: {
    label: "Kimi Open Platform",
    agentSdkCompatible: true,
    anthropicCompatible: false,
    transport: "openai-adapter",
    authMode: "bearer",
    modelsEndpoint: "https://api.moonshot.cn/v1/models",
    baseUrls: [{ label: "Kimi Open Platform", value: "https://api.moonshot.cn/v1" }],
    models: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "kimi-k2.5", "moonshot-v1-128k"],
    defaultCapabilities: { ...textOnlyCapabilities, contextWindowTokens: 256_000, reasoning: true, promptCache: { mode: "automatic", enabled: true, reportsUsage: true } },
    reasoning
  },
  fake: {
    label: "Fake test provider",
    public: false,
    anthropicCompatible: false,
    baseUrls: [],
    models: ["fake-text-model"],
    defaultCapabilities: textOnlyCapabilities,
    reasoning: basicReasoning
  }
};

export const fallbackModelCapabilities = Object.freeze({
  ...textOnlyCapabilities,
  input: Object.freeze({ ...textOnlyCapabilities.input }),
  promptCache: Object.freeze({ ...textOnlyCapabilities.promptCache })
});

export function resolveModelCapabilities(provider, model) {
  const catalog = providerCatalog[String(provider ?? "").toLowerCase()];
  const defaults = catalog?.defaultCapabilities ?? fallbackModelCapabilities;
  const modelOverrides = catalog?.modelCapabilities?.[model] ?? {};
  return {
    ...fallbackModelCapabilities,
    ...defaults,
    ...modelOverrides,
    input: { ...fallbackModelCapabilities.input, ...defaults.input, ...modelOverrides.input },
    promptCache: { ...fallbackModelCapabilities.promptCache, ...defaults.promptCache, ...modelOverrides.promptCache }
  };
}

export function resolveModelReasoning(provider, model) {
  const catalog = providerCatalog[String(provider ?? "").toLowerCase()];
  const defaults = catalog?.reasoning ?? basicReasoning;
  const override = catalog?.modelReasoning?.[model] ?? {};
  const efforts = Array.isArray(override.efforts) ? override.efforts : defaults.efforts;
  const supported = override.supported ?? defaults.supported;
  return {
    supported: Boolean(supported),
    efforts: supported ? [...efforts] : [],
    defaultEnabled: override.defaultEnabled ?? defaults.defaultEnabled,
    defaultEffort: override.defaultEffort ?? defaults.defaultEffort,
    thinkingMode: override.thinkingMode ?? defaults.thinkingMode ?? "none",
    budgetTokens: override.budgetTokens ?? defaults.budgetTokens ?? null
  };
}

export function publicProviderCatalog() {
  return Object.fromEntries(Object.entries(providerCatalog)
    .filter(([, config]) => config.public !== false && (config.anthropicCompatible || config.agentSdkCompatible))
    .map(([id, config]) => [id, {
      label: config.label,
      protocol: config.transport === "openai-adapter" ? "anthropic-via-openai-adapter" : "anthropic",
      transport: config.transport ?? "anthropic-native",
      baseUrls: config.baseUrls,
      models: config.models,
      reasoning: config.reasoning ?? basicReasoning,
      defaultCapabilities: resolveModelCapabilities(id),
      modelCapabilities: config.modelCapabilities ?? {},
      modelProfiles: Object.fromEntries(config.models.map((model) => [model, {
        capabilities: resolveModelCapabilities(id, model),
        reasoning: resolveModelReasoning(id, model)
      }]))
    }]));
}
