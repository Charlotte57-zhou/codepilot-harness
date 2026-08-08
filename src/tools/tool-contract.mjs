/**
 * @template TInput
 * @typedef {object} Tool
 * @property {string} name
 * @property {string} description
 * @property {{ safeParse(input: unknown): { success: boolean, data?: TInput, error?: unknown } }} inputSchema
 * @property {object | undefined} inputJSONSchema
 * @property {boolean} isReadOnly
 * @property {boolean} isConcurrencySafe
 * @property {"immediate"} interruptBehavior
 * @property {number} maxResultSizeChars
 * @property {{ semanticKey: string, family: string, action: string } | undefined} activity
 * @property {(input: TInput, context: { workspaceRoot: string, signal?: AbortSignal }) => Promise<void | import("./tool-result.mjs").ToolResult>} validateInput
 * @property {(input: TInput, context: { workspaceRoot: string, signal?: AbortSignal }) => Promise<{ decision: "allow" | "deny" | "ask" | "passthrough", code?: string, message?: string, details?: object, summary?: string, diff?: string, command?: string, file?: string }>} checkPermissions
 * @property {(input: TInput, context: { workspaceRoot: string, signal?: AbortSignal }) => Promise<{ toolName: string, operation: string, path?: string, command?: string, cwd?: string }>} preparePermissionMatcher
 * @property {(input: TInput, context: { phase: "requested" | "completed", result?: import("./tool-result.mjs").ToolResult }) => { title: string, detail: string }} renderToolUseMessage
 * @property {(input: TInput, context: { workspaceRoot: string, signal?: AbortSignal }) => Promise<import("./tool-result.mjs").ToolResult>} call
 */

/**
 * Builds a Tool with conservative scheduling defaults.
 * @template TInput
 * @param {{ name: string, description: string, inputSchema: { safeParse(input: unknown): unknown }, inputJSONSchema?: object, isReadOnly?: boolean, isConcurrencySafe?: boolean, interruptBehavior?: "immediate", maxResultSizeChars?: number, activity?: { semanticKey: string, family: string, action: string }, validateInput?: Function, checkPermissions?: Function, preparePermissionMatcher?: Function, renderToolUseMessage?: Function, call: Function }} definition
 * @returns {Tool<TInput>}
 */
export function buildTool(definition) {
  if (!definition || typeof definition !== "object") throw new TypeError("Tool definition is required");
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(definition.name ?? "")) throw new TypeError("Tool name must be an identifier-like string");
  if (typeof definition.description !== "string" || !definition.description.trim()) throw new TypeError("Tool description is required");
  if (!definition.inputSchema || typeof definition.inputSchema.safeParse !== "function") throw new TypeError("Tool inputSchema must provide safeParse()");
  if (typeof definition.call !== "function") throw new TypeError("Tool call() is required");
  if (definition.interruptBehavior !== undefined && definition.interruptBehavior !== "immediate") throw new TypeError("Tool interruptBehavior must be immediate");
  if (definition.maxResultSizeChars !== undefined && (!Number.isInteger(definition.maxResultSizeChars) || definition.maxResultSizeChars < 1)) {
    throw new TypeError("Tool maxResultSizeChars must be a positive integer");
  }
  if (definition.activity !== undefined && (!definition.activity.semanticKey || !definition.activity.family || !definition.activity.action)) {
    throw new TypeError("Tool activity requires semanticKey, family and action");
  }

  return Object.freeze({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    inputJSONSchema: definition.inputJSONSchema,
    isReadOnly: definition.isReadOnly ?? false,
    isConcurrencySafe: definition.isConcurrencySafe ?? false,
    interruptBehavior: definition.interruptBehavior ?? "immediate",
    maxResultSizeChars: definition.maxResultSizeChars ?? 100_000,
    activity: definition.activity ? Object.freeze({ ...definition.activity }) : undefined,
    validateInput: definition.validateInput ?? (async () => undefined),
    checkPermissions: definition.checkPermissions ?? (async () => ({ decision: "passthrough" })),
    preparePermissionMatcher: definition.preparePermissionMatcher ?? (async () => ({
      toolName: definition.name,
      operation: definition.isReadOnly ? "read" : "execute"
    })),
    renderToolUseMessage: definition.renderToolUseMessage ?? ((input) => ({
      title: definition.name,
      detail: JSON.stringify(input)
    })),
    call: definition.call
  });
}
