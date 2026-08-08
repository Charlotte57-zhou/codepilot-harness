import { createSdkMcpServer, tool as createSdkTool } from "@anthropic-ai/claude-agent-sdk";

const sdkOwnedToolNames = new Set([
  "Agent", "Bash", "CreateDirectory", "Delete", "Edit", "Glob", "Grep",
  "ListFiles", "NotebookEdit", "Read", "Search", "TaskCreate", "TaskGet",
  "TaskList", "TaskOutput", "TaskStop", "TaskUpdate", "UpdateTodoList", "Write"
]);

function rawShape(schema) {
  const shape = schema?.shape;
  if (!shape || typeof shape !== "object") throw new TypeError("SDK MCP tools require a Zod object schema");
  return shape;
}

function mcpResult(result) {
  return {
    content: [{
      type: "text",
      text: typeof result?.content === "string" ? result.content : JSON.stringify(result ?? {})
    }],
    isError: result?.ok !== true,
    ...(result?.metadata && typeof result.metadata === "object"
      ? { structuredContent: { metadata: result.metadata } }
      : {})
  };
}

export function codePilotToolName(sdkToolName) {
  const match = /^mcp__codepilot__([A-Za-z][A-Za-z0-9_]*)$/.exec(String(sdkToolName ?? ""));
  return match?.[1] ?? null;
}

export function sdkExtensionTools(toolRegistry) {
  return toolRegistry.list().filter((candidate) => !sdkOwnedToolNames.has(candidate.name));
}

export function createCodePilotSdkMcpServer({
  toolRegistry,
  contextFactory,
  name = "codepilot",
  version = "0.1.0"
} = {}) {
  if (!toolRegistry || typeof toolRegistry.list !== "function" || typeof toolRegistry.execute !== "function") {
    throw new TypeError("createCodePilotSdkMcpServer requires a ToolRegistry");
  }
  if (typeof contextFactory !== "function") throw new TypeError("createCodePilotSdkMcpServer requires contextFactory");

  return createSdkMcpServer({
    name,
    version,
    instructions: "CodePilot product capabilities supplement the Claude Agent SDK for browser, desktop, preview, installed Skill, and project MCP operations.",
    tools: sdkExtensionTools(toolRegistry).map((candidate) => createSdkTool(
      candidate.name,
      candidate.description,
      rawShape(candidate.inputSchema),
      async (input, extra) => mcpResult(await toolRegistry.execute(candidate.name, input, contextFactory(candidate.name, extra))),
      {
        annotations: {
          readOnlyHint: candidate.isReadOnly === true,
          destructiveHint: candidate.isReadOnly !== true,
          idempotentHint: candidate.isReadOnly === true,
          openWorldHint: /^(?:Browser|Computer|Mcp)/.test(candidate.name)
        },
        alwaysLoad: /^(?:PreviewArtifact|Browser|Computer|Interaction)/.test(candidate.name)
      }
    ))
  });
}
