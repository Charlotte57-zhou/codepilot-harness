import test from "node:test";
import assert from "node:assert/strict";
import { anthropicSdkEnvironment, normalizeAnthropicProviderId, resolveAnthropicProviderProfile } from "../src/anthropic-provider-profile.mjs";
import { publicProviderCatalog, resolveModelCapabilities, resolveModelReasoning } from "../src/provider-catalog.mjs";

test("public model configuration contains only Agent SDK-compatible transports", () => {
  const catalog = publicProviderCatalog();
  assert.equal(catalog.openai, undefined);
  assert.equal(catalog.fake, undefined);
  assert.equal(catalog["claude-agent-sdk"], undefined);
  assert.deepEqual(Object.keys(catalog), ["anthropic", "deepseek", "moonshot"]);
  assert.ok(Object.values(catalog).every((provider) => provider.protocol.startsWith("anthropic")));
  assert.equal(catalog.moonshot.transport, "openai-adapter");
  assert.equal(catalog.moonshot.models[0], "kimi-k3");
});

test("Moonshot Open Platform resolves to the local adapter transport", () => {
  const profile = resolveAnthropicProviderProfile({ provider: "moonshot", apiKey: "secret" });
  assert.equal(profile.baseUrl, "https://api.moonshot.cn/v1");
  assert.equal(profile.model, "kimi-k3");
  assert.equal(profile.transport, "openai-adapter");
});

test("model profiles expose model-specific capability and effort semantics", () => {
  const catalog = publicProviderCatalog();
  assert.equal(catalog.anthropic.modelProfiles["claude-sonnet-4-6"].capabilities.contextWindowTokens, 1_000_000);
  assert.equal(catalog.anthropic.modelProfiles["claude-haiku-4-5"].capabilities.contextWindowTokens, 200_000);
  assert.equal(resolveModelCapabilities("anthropic", "claude-opus-4-6").maxOutputTokens, 128_000);
  assert.equal(resolveModelReasoning("anthropic", "claude-sonnet-4-6").supported, true);
  assert.equal(resolveModelReasoning("anthropic", "claude-haiku-4-5").supported, false);
  assert.equal(resolveModelReasoning("anthropic", "claude-haiku-4-5").thinkingMode, "enabled");
});

test("provider ids and profile fields use the current contract without aliases", () => {
  assert.equal(normalizeAnthropicProviderId("anthropic"), "anthropic");
  assert.throws(() => normalizeAnthropicProviderId("claude-agent-sdk"), /Unknown Agent SDK provider/);
  assert.throws(() => normalizeAnthropicProviderId("openai"), /Unknown Agent SDK provider/);
  const profile = resolveAnthropicProviderProfile({
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    model: "custom-current-model"
  });
  assert.equal(profile.baseUrl, "https://api.deepseek.com");
  assert.equal(profile.model, "custom-current-model");
});

test("third-party SDK environment uses auth token and one model for every SDK role", () => {
  const profile = resolveAnthropicProviderProfile({ provider: "deepseek", apiKey: "secret" });
  const env = anthropicSdkEnvironment(profile, { ANTHROPIC_API_KEY: "stale" });
  assert.equal(env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, "secret");
  assert.equal(env.ANTHROPIC_API_KEY, "");
  assert.equal(env.ANTHROPIC_MODEL, "deepseek-v4-pro");
  assert.equal(env.CLAUDE_CODE_SUBAGENT_MODEL, "deepseek-v4-pro");
});

test("Anthropic first-party SDK environment uses x-api-key authentication", () => {
  const profile = resolveAnthropicProviderProfile({ provider: "anthropic", apiKey: "secret" });
  const env = anthropicSdkEnvironment(profile, { ANTHROPIC_AUTH_TOKEN: "stale" });
  assert.equal(env.ANTHROPIC_API_KEY, "secret");
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
});
