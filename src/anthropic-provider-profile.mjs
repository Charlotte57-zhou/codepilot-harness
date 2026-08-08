import { providerCatalog } from "./provider-catalog.mjs";

export function normalizeAnthropicProviderId(value, { allowInternal = true } = {}) {
  const requested = String(value ?? "").trim().toLowerCase();
  const provider = providerCatalog[requested];
  if ((provider?.anthropicCompatible || provider?.agentSdkCompatible) && (allowInternal || provider.public !== false)) return requested;
  throw new TypeError(`Unknown Agent SDK provider: ${requested || "<empty>"}`);
}

export function resolveAnthropicProviderProfile({ provider, baseUrl, model, apiKey } = {}) {
  const id = normalizeAnthropicProviderId(provider);
  const config = providerCatalog[id];
  if (!config?.anthropicCompatible && !config?.agentSdkCompatible) throw new TypeError(`Provider ${id} lacks an Agent SDK transport profile`);
  const requestedBaseUrl = String(baseUrl ?? "").trim().replace(/\/$/, "");
  const resolvedBaseUrl = requestedBaseUrl || config.baseUrls[0]?.value;
  const requestedModel = String(model ?? "").trim();
  const resolvedModel = requestedModel || config.models[0];
  if (!resolvedBaseUrl || !resolvedModel) throw new TypeError(`Provider ${id} has an incomplete Anthropic profile`);
  return Object.freeze({
    id,
    label: config.label,
    baseUrl: resolvedBaseUrl.replace(/\/$/, ""),
    model: resolvedModel,
    apiKey: String(apiKey ?? ""),
    authMode: config.authMode ?? "auth_token",
    transport: config.transport ?? "anthropic-native",
    auxiliaryMessagesBaseUrl: `${resolvedBaseUrl.replace(/\/$/, "")}/v1`
  });
}

export function anthropicSdkEnvironment(profile, environment = process.env) {
  const env = { ...environment };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  env.ANTHROPIC_BASE_URL = profile.baseUrl;
  env.ANTHROPIC_MODEL = profile.model;
  env.ANTHROPIC_DEFAULT_OPUS_MODEL = profile.model;
  env.ANTHROPIC_DEFAULT_SONNET_MODEL = profile.model;
  env.ANTHROPIC_DEFAULT_HAIKU_MODEL = profile.model;
  env.CLAUDE_CODE_SUBAGENT_MODEL = profile.model;
  if (profile.authMode === "api_key") env.ANTHROPIC_API_KEY = profile.apiKey;
  else {
    env.ANTHROPIC_AUTH_TOKEN = profile.apiKey;
    env.ANTHROPIC_API_KEY = "";
  }
  return env;
}
