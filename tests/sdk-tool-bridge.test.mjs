import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { createCodePilotSdkMcpServer, codePilotToolName, sdkExtensionTools } from "../src/sdk-tool-bridge.mjs";
import { buildTool } from "../src/tools/tool-contract.mjs";
import { ToolRegistry } from "../src/tools/tool-registry.mjs";
import { toolSuccess } from "../src/tools/tool-result.mjs";

test("SDK bridge excludes SDK-owned coding tools and keeps CodePilot extensions", () => {
  const registry = new ToolRegistry([
    buildTool({ name: "Read", description: "SDK duplicate", inputSchema: z.object({ path: z.string() }), call: async () => toolSuccess("read") }),
    buildTool({ name: "BrowserInspect", description: "Inspect browser", inputSchema: z.object({ sessionId: z.string() }), call: async () => toolSuccess("ok") })
  ]);
  assert.deepEqual(sdkExtensionTools(registry).map((tool) => tool.name), ["BrowserInspect"]);
});

test("SDK bridge builds an in-process MCP server for CodePilot Tool contracts", () => {
  const registry = new ToolRegistry([
    buildTool({
      name: "PreviewArtifact",
      description: "Preview one artifact",
      inputSchema: z.object({ path: z.string().min(1) }).strict(),
      isReadOnly: true,
      async call(input) {
        return toolSuccess(`preview:${input.path}`);
      }
    })
  ]);
  const server = createCodePilotSdkMcpServer({
    toolRegistry: registry,
    contextFactory: (name) => ({ workspaceRoot: "TARGET", toolCallId: name })
  });
  assert.equal(server.type, "sdk");
  assert.equal(server.name, "codepilot");
  assert.ok(server.instance);
  assert.equal(codePilotToolName("mcp__codepilot__PreviewArtifact"), "PreviewArtifact");
  assert.equal(codePilotToolName("Read"), null);
});
