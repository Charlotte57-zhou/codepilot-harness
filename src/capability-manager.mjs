import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { z } from "zod";
import { buildTool } from "./tools/tool-contract.mjs";
import { ToolRegistry } from "./tools/tool-registry.mjs";
import { toolError, toolSuccess } from "./tools/tool-result.mjs";
import { buildSkillTool, isSkillEligible, loadSkillCatalog } from "./skill-catalog.mjs";
import { buildDiscoverSkillsTool, buildInstallSkillTool } from "./skill-installer.mjs";
import { loadEnabledMcpDescriptors } from "./mcp-catalog.mjs";
import { McpNeedsAuthError } from "./mcp-auth-manager.mjs";

const inheritedMcpEnvironmentKeys = new Set([
  "appdata", "comspec", "home", "localappdata", "path", "pathext",
  "systemroot", "temp", "tmp", "userprofile", "windir"
]);

export function buildMcpProcessEnv(explicitEnvironment = {}, sourceEnvironment = process.env) {
  const environment = {};
  for (const [key, value] of Object.entries(sourceEnvironment)) {
    if (value !== undefined && inheritedMcpEnvironmentKeys.has(key.toLowerCase())) environment[key] = value;
  }
  for (const [key, value] of Object.entries(explicitEnvironment ?? {})) {
    if (value !== undefined) environment[key] = String(value);
  }
  return environment;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function snapshotId(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex").slice(0, 16);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizeMcpToolName(serverName, name) {
  return `mcp__${serverName}__${name}`.replace(/[^A-Za-z0-9_]/g, "_");
}

function mcpContentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => item.text ?? JSON.stringify(item)).join("\n");
  return JSON.stringify(content ?? {});
}

function mcpToolContract(server, tool) {
  const name = normalizeMcpToolName(server.name, tool.name);
  return buildTool({
    name,
    description: `[MCP ${server.name}] ${tool.description ?? tool.name}`,
    inputSchema: z.any(),
    inputJSONSchema: tool.inputSchema ?? { type: "object", additionalProperties: true },
    isReadOnly: tool.annotations?.readOnlyHint === true,
    isConcurrencySafe: tool.annotations?.readOnlyHint === true,
    checkPermissions: async () => ({ decision: tool.annotations?.readOnlyHint ? "passthrough" : "ask", summary: `Use MCP tool ${server.name}/${tool.name}` }),
    preparePermissionMatcher: async () => ({ toolName: name, operation: "mcp", server: server.name, remoteTool: tool.name }),
    renderToolUseMessage: (input, view) => ({
      title: `${server.name}: ${tool.name}`,
      detail: view.phase === "completed" ? `${tool.name} completed` : JSON.stringify(input)
    }),
    call: async (input) => {
      try {
        const result = await server.callTool(tool.name, input);
        if (result?.isError) return toolError("MCP_TOOL_ERROR", mcpContentToText(result.content), { server: server.name, tool: tool.name });
        return toolSuccess(mcpContentToText(result?.content), { server: server.name, tool: tool.name });
      } catch (error) {
        return toolError("MCP_TOOL_FAILED", "MCP tool invocation failed", { server: server.name, tool: tool.name, message: error instanceof Error ? error.message : String(error) });
      }
    }
  });
}

/** Minimal JSON-RPC-over-stdio MCP transport. It intentionally owns no policy. */
export class StdioMcpClient {
  constructor(descriptor, { timeoutMs = 10_000 } = {}) {
    this.descriptor = descriptor;
    this.timeoutMs = timeoutMs;
    this.child = undefined;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
  }

  async connect() {
    if (this.child) return;
    if (!this.descriptor.command) throw new Error(`MCP server ${this.descriptor.name} has no command`);
    this.child = spawn(this.descriptor.command, this.descriptor.args ?? [], {
      cwd: this.descriptor.cwd,
      env: buildMcpProcessEnv(this.descriptor.env),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.#receive(chunk));
    // Drain diagnostics so a noisy MCP process cannot block on a full stderr pipe.
    this.child.stderr.resume();
    this.child.on("error", (error) => this.#failAll(error));
    this.child.on("exit", () => this.#failAll(new Error(`MCP server ${this.descriptor.name} disconnected`)));
    await this.request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "codepilot", version: "0.1.0" } });
    this.notify("notifications/initialized", {});
  }

  async listTools() {
    await this.connect();
    return (await this.request("tools/list", {})).tools ?? [];
  }

  async callTool(name, arguments_) {
    await this.connect();
    return this.request("tools/call", { name, arguments: arguments_ });
  }

  notify(method, params) {
    this.child?.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  request(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP ${this.descriptor.name} timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async close() {
    const child = this.child;
    this.child = undefined;
    if (!child) return;
    this.#failAll(new Error(`MCP server ${this.descriptor.name} closed`));
    child.kill();
  }

  #receive(chunk) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let response;
      try { response = JSON.parse(line); } catch { continue; }
      const pending = this.pending.get(response.id);
      if (!pending) continue;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      response.error ? pending.reject(new Error(response.error.message ?? "MCP error")) : pending.resolve(response.result);
    }
  }

  #failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function parseSseJson(text) {
  const dataLines = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) throw new Error("MCP HTTP response did not contain an SSE data event");
  return JSON.parse(dataLines.join("\n"));
}

/** Minimal MCP Streamable HTTP transport with session-id support. */
export class HttpMcpClient {
  constructor(descriptor, { timeoutMs = 10_000, fetchImpl = fetch, authManager } = {}) {
    this.descriptor = descriptor;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.authManager = authManager;
    this.nextId = 1;
    this.sessionId = undefined;
    this.connected = false;
  }

  async connect() {
    if (this.connected) return;
    if (!this.descriptor.url) throw new Error(`MCP server ${this.descriptor.name} has no URL`);
    await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "codepilot", version: "0.1.0" }
    });
    await this.notify("notifications/initialized", {});
    this.connected = true;
  }

  async listTools() {
    await this.connect();
    return (await this.request("tools/list", {})).tools ?? [];
  }

  async callTool(name, arguments_) {
    await this.connect();
    return this.request("tools/call", { name, arguments: arguments_ });
  }

  async notify(method, params) {
    await this.#post({ jsonrpc: "2.0", method, params }, { notification: true });
  }

  async request(method, params) {
    const id = this.nextId++;
    const response = await this.#post({ jsonrpc: "2.0", id, method, params });
    if (response?.error) throw new Error(response.error.message ?? `MCP error ${response.error.code ?? ""}`.trim());
    return response?.result;
  }

  async close() {
    if (this.sessionId) {
      try {
        const accessToken = await this.authManager?.getAccessToken(this.descriptor);
        await this.fetchImpl(this.descriptor.url, {
          method: "DELETE",
          headers: {
            "mcp-session-id": this.sessionId,
            ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
          },
          signal: AbortSignal.timeout(Math.min(this.timeoutMs, 2_000))
        });
      } catch {}
    }
    this.connected = false;
    this.sessionId = undefined;
  }

  async #post(message, { notification = false } = {}) {
    const accessToken = await this.authManager?.getAccessToken(this.descriptor);
    const headers = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
    };
    const response = await this.fetchImpl(this.descriptor.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (response.status === 401) {
      await this.authManager?.markNeedsAuth(this.descriptor);
      throw new McpNeedsAuthError(this.descriptor.name);
    }
    if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    if (notification || response.status === 202 || response.status === 204) return undefined;
    const text = await response.text();
    if (!text.trim()) return undefined;
    return response.headers.get("content-type")?.includes("text/event-stream")
      ? parseSseJson(text)
      : JSON.parse(text);
  }
}

export function createMcpClientForDescriptor(descriptor, options = {}) {
  if (["http", "streamable-http"].includes(descriptor?.type)) return new HttpMcpClient(descriptor, options);
  return new StdioMcpClient(descriptor, options);
}

/**
 * Merges built-ins, project skills and MCP tools into a fresh snapshot. No global
 * registry is mutated; therefore a tool refresh can only affect the next turn.
 */
export class CapabilityManager {
  constructor({
    workspaceRoot,
    baseToolRegistry,
    createMcpClient,
    authManager,
    installFetch,
    githubToken,
    onEvent
  } = {}) {
    if (!workspaceRoot || !baseToolRegistry) throw new TypeError("CapabilityManager requires workspaceRoot and baseToolRegistry");
    this.workspaceRoot = workspaceRoot;
    this.baseToolRegistry = baseToolRegistry;
    this.createMcpClient = createMcpClient ?? ((descriptor) => createMcpClientForDescriptor(descriptor, { authManager }));
    this.installFetch = installFetch;
    this.githubToken = githubToken;
    this.onEvent = onEvent;
    this.clients = new Map();
  }

  async refresh({ task = "", touchedPaths = [] } = {}) {
    const [skillCatalog, descriptors] = await Promise.all([loadSkillCatalog(this.workspaceRoot), loadEnabledMcpDescriptors(this.workspaceRoot)]);
    const availableSkills = skillCatalog.skills.map((skill) => Object.freeze({
      ...skill,
      eligible: isSkillEligible(skill, { task, touchedPaths }),
      lifecycleStage: "discovered"
    }));
    const skills = availableSkills.filter((skill) => skill.eligible);
    const mcpServers = [];
    const mcpTools = [];
    for (const descriptor of descriptors.sort((a, b) => a.name.localeCompare(b.name))) {
      const fingerprint = snapshotId(descriptor);
      // A capability snapshot freezes live MCP handles for the complete run.
      // Keep previous fingerprints alive until server shutdown so a later
      // configuration refresh cannot invalidate an already-running snapshot.
      const clientKey = `${descriptor.name}:${fingerprint}`;
      let entry = this.clients.get(clientKey);
      if (!entry) {
        entry = { client: this.createMcpClient(descriptor), fingerprint };
        this.clients.set(clientKey, entry);
      }
      const client = entry.client;
      try {
        const tools = await client.listTools();
        const server = { name: descriptor.name, callTool: (name, input) => client.callTool(name, input) };
        mcpTools.push(...tools.map((tool) => mcpToolContract(server, tool)));
        mcpServers.push({ name: descriptor.name, toolCount: tools.length });
        await this.onEvent?.("mcp_tools_refreshed", { server: descriptor.name, toolCount: tools.length });
      } catch (error) {
        await client.close?.();
        this.clients.delete(clientKey);
        const eventType = error?.code === "MCP_NEEDS_AUTH" ? "mcp_auth_required" : "mcp_connection_failed";
        await this.onEvent?.(eventType, { server: descriptor.name, message: error instanceof Error ? error.message : String(error) });
      }
    }
    const skillTool = buildSkillTool(skills);
    const installSkillTool = buildInstallSkillTool({
      workspaceRoot: this.workspaceRoot,
      ...(this.installFetch ? { fetchImpl: this.installFetch } : {}),
      githubToken: this.githubToken
    });
    const discoverSkillsTool = buildDiscoverSkillsTool({
      ...(this.installFetch ? { fetchImpl: this.installFetch } : {}),
      githubToken: this.githubToken
    });
    const registry = new ToolRegistry([
      ...this.baseToolRegistry.list(),
      ...(skillTool ? [skillTool] : []),
      discoverSkillsTool,
      installSkillTool,
      ...mcpTools
    ]);
    const toolDefinitions = registry.toModelDefinitions().sort((a, b) => a.name.localeCompare(b.name));
    const id = snapshotId({
      tools: toolDefinitions,
      skills: skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        path: skill.path,
        executionContext: skill.executionContext,
        allowedTools: skill.allowedTools,
        trust: skill.trust,
        instructions: skill.instructions
      })),
      mcpServers
    });
    return deepFreeze({
      id,
      toolRegistry: registry,
      toolDefinitions,
      skills,
      availableSkills,
      skillDiagnostics: skillCatalog.diagnostics,
      skillLifecycle: availableSkills.map((skill) => ({
        name: skill.name,
        installed: true,
        discovered: true,
        eligible: skill.eligible,
        advertised: skills.some((candidate) => candidate.name === skill.name)
      })),
      mcpServers
    });
  }

  async close() {
    await Promise.all([...this.clients.values()].map((entry) => entry.client.close?.()));
    this.clients.clear();
  }
}

export { loadSkillsDir, loadSkillState, setSkillEnabled, uninstallSkill } from "./skill-catalog.mjs";
