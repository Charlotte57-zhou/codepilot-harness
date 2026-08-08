import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

test("desktop composition root routes every configured provider through ClaudeAgentRuntime", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const runBody = source.slice(source.indexOf("async function runTextAgent"), source.indexOf("async function fetchProviderModels"));
  assert.match(runBody, /return await claudeAgentRuntime\.run\(/);
  assert.match(runBody, /anthropicOpenAiGateway\.register\(/);
  assert.match(runBody, /createCodePilotSdkMcpServer\(/);
  assert.doesNotMatch(runBody, /queryLoop\(/);
  assert.doesNotMatch(runBody, /sdkEngine/);
  assert.doesNotMatch(source, /from "\.\/src\/query-loop\.mjs"/);
  for (const relativePath of [
    "../src/query-loop.mjs",
    "../src/model-client.mjs",
    "../src/subagent-runtime.mjs",
    "../src/tools/tool-orchestrator.mjs",
    "../src/tools/write-tools.mjs"
  ]) {
    await assert.rejects(access(new URL(relativePath, import.meta.url)));
  }
});
