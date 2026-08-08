import { isToolResult, toolCancelled, toolError } from "./tool-result.mjs";
import { z } from "zod";

function inputJsonSchema(tool) {
  if (tool.inputJSONSchema) return tool.inputJSONSchema;
  const schema = z.toJSONSchema(tool.inputSchema, { target: "draft-7", unrepresentable: "any" });
  if (schema?.type !== "object") throw new TypeError(`Tool ${tool.name} must expose an object input schema`);
  return schema;
}

function limitToolResult(result, maxResultSizeChars) {
  if (!result.ok || result.content.length <= maxResultSizeChars) return result;
  const originalChars = result.content.length;
  const marker = "\n...[tool result truncated]...\n";
  const available = maxResultSizeChars - marker.length;
  const headChars = available > 1 ? Math.ceil(available / 2) : maxResultSizeChars;
  const tailChars = available > 1 ? Math.floor(available / 2) : 0;
  const content = tailChars > 0
    ? `${result.content.slice(0, headChars)}${marker}${result.content.slice(-tailChars)}`
    : result.content.slice(0, maxResultSizeChars);
  return {
    ...result,
    content,
    metadata: {
      ...result.metadata,
      truncated: true,
      truncation: {
        strategy: tailChars > 0 ? "head_tail" : "head_only",
        originalChars,
        retainedHeadChars: headChars,
        retainedTailChars: tailChars,
        omittedChars: originalChars - headChars - tailChars,
        maxResultSizeChars
      }
    }
  };
}

export class ToolRegistry {
  #tools = new Map();

  constructor(tools = []) {
    for (const tool of tools) this.register(tool);
  }

  register(tool) {
    if (!tool?.name || typeof tool.call !== "function" || typeof tool.inputSchema?.safeParse !== "function") {
      throw new TypeError("ToolRegistry only accepts Tool contract objects");
    }
    if (this.#tools.has(tool.name)) throw new Error(`Tool already registered: ${tool.name}`);
    this.#tools.set(tool.name, tool);
    return this;
  }

  get(name) {
    return this.#tools.get(name);
  }

  list() {
    return [...this.#tools.values()];
  }

  toModelDefinitions() {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: inputJsonSchema(tool),
      isReadOnly: tool.isReadOnly,
      isConcurrencySafe: tool.isConcurrencySafe,
      interruptBehavior: tool.interruptBehavior
    }));
  }

  async validate(name, input, context) {
    const tool = this.get(name);
    if (!tool) return { result: toolError("TOOL_NOT_FOUND", `No tool is registered as ${name}`) };

    const parsed = tool.inputSchema.safeParse(input);
    if (!parsed.success) {
      return { result: toolError("SCHEMA_VALIDATION_FAILED", "Tool input did not match the declared schema", {
        issues: parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code }))
      }) };
    }

    try {
      const validation = await tool.validateInput(parsed.data, context);
      if (isToolResult(validation)) return { result: validation };
      return { tool, input: parsed.data };
    } catch (error) {
      return { result: toolError("INPUT_VALIDATION_FAILED", `Tool ${name} input is not valid in the current workspace`, {
        message: error instanceof Error ? error.message : "Unknown input validation error"
      }) };
    }
  }

  async executeValidated(tool, input, context) {
    if (context?.signal?.aborted && tool.interruptBehavior === "immediate") {
      const cancellation = context.signal.reason ?? {};
      return toolCancelled(`Tool ${tool.name} was cancelled before execution`, {
        reason: cancellation.reason ?? "user_stop",
        code: cancellation.code ?? "USER_STOP",
        executionStarted: false
      });
    }

    try {
      const result = await tool.call(input, context);
      return isToolResult(result)
        ? limitToolResult(result, tool.maxResultSizeChars)
        : toolError("INVALID_TOOL_RESULT", `Tool ${tool.name} did not return a standard ToolResult`);
    } catch (error) {
      return toolError("TOOL_EXECUTION_FAILED", `Tool ${tool.name} failed to execute`, {
        message: error instanceof Error ? error.message : "Unknown tool error"
      });
    }
  }

  async execute(name, input, context) {
    const validated = await this.validate(name, input, context);
    return validated.result ?? this.executeValidated(validated.tool, validated.input, context);
  }
}
