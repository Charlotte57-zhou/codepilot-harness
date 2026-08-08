import { resolveModelCapabilities } from "./provider-catalog.mjs";

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function booleanOverride(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (String(value).toLowerCase() === "true") return true;
  if (String(value).toLowerCase() === "false") return false;
  return fallback;
}

function promptCacheMode(value, fallback) {
  return ["none", "automatic", "explicit"].includes(String(value ?? "").toLowerCase())
    ? String(value).toLowerCase()
    : fallback;
}

export function normalizeModelCapabilities(capabilities = {}) {
  return Object.freeze({
    contextWindowTokens: positiveInteger(capabilities.contextWindowTokens, 128_000),
    maxOutputTokens: positiveInteger(capabilities.maxOutputTokens, 8_000),
    safetyBufferTokens: positiveInteger(capabilities.safetyBufferTokens, 4_000),
    input: Object.freeze({
      text: capabilities.input?.text !== false,
      image: capabilities.input?.image === true,
      pdf: capabilities.input?.pdf === true
    }),
    toolCalling: capabilities.toolCalling !== false,
    reasoning: capabilities.reasoning === true,
    promptCache: Object.freeze({
      mode: promptCacheMode(capabilities.promptCache?.mode, "none"),
      enabled: capabilities.promptCache?.enabled === true,
      reportsUsage: capabilities.promptCache?.reportsUsage === true
    })
  });
}

export function modelCapabilitiesFromEnvironment(env = process.env) {
  const defaults = resolveModelCapabilities(env.MODEL_PROVIDER, env.MODEL_NAME);
  return normalizeModelCapabilities({
    contextWindowTokens: positiveInteger(env.MODEL_CONTEXT_WINDOW_TOKENS, defaults.contextWindowTokens),
    maxOutputTokens: positiveInteger(env.MODEL_MAX_OUTPUT_TOKENS, defaults.maxOutputTokens),
    safetyBufferTokens: positiveInteger(env.MODEL_CONTEXT_SAFETY_BUFFER_TOKENS, defaults.safetyBufferTokens),
    input: {
      text: true,
      image: booleanOverride(env.MODEL_SUPPORTS_IMAGE_INPUT, defaults.input.image),
      pdf: booleanOverride(env.MODEL_SUPPORTS_PDF_INPUT, defaults.input.pdf)
    },
    toolCalling: booleanOverride(env.MODEL_SUPPORTS_TOOL_CALLING, defaults.toolCalling),
    reasoning: booleanOverride(env.MODEL_SUPPORTS_REASONING, defaults.reasoning),
    promptCache: {
      mode: promptCacheMode(env.MODEL_PROMPT_CACHE_MODE, defaults.promptCache.mode),
      enabled: booleanOverride(env.MODEL_PROMPT_CACHE_ENABLED, defaults.promptCache.enabled),
      reportsUsage: booleanOverride(env.MODEL_REPORTS_PROMPT_CACHE_USAGE, defaults.promptCache.reportsUsage)
    }
  });
}
