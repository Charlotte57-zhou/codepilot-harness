import assert from "node:assert/strict";
import test from "node:test";
import { modelCapabilitiesFromEnvironment } from "../src/model-capabilities.mjs";

test("model capability projection remains a provider policy helper, not an Agent client", () => {
  const capabilities = modelCapabilitiesFromEnvironment({
    MODEL_PROVIDER: "anthropic",
    MODEL_NAME: "claude-sonnet-4-5",
    MODEL_SUPPORTS_IMAGE_INPUT: "false",
    MODEL_MAX_OUTPUT_TOKENS: "4096"
  });
  assert.equal(capabilities.input.image, false);
  assert.equal(capabilities.maxOutputTokens, 4096);
  assert.equal(typeof capabilities.toolCalling, "boolean");
});
