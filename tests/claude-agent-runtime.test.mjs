import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAgentRuntime } from "../src/claude-agent-runtime.mjs";
import { ToolRegistry } from "../src/tools/tool-registry.mjs";
import { buildTool } from "../src/tools/tool-contract.mjs";
import { toolSuccess } from "../src/tools/tool-result.mjs";
import { z } from "zod";

const budgetPolicy = { maxTurns: 12, maxRetries: 3, deadlineMs: 60_000, maxOutputTokens: 8_000, compactionOutputTokens: 2_000 };

function fakeQuery(messages, capture = {}, onStart) {
  return (params) => {
    capture.params = params;
    return (async function* () {
      await onStart?.();
      for (const message of messages) yield message;
    })();
  };
}

test("ClaudeAgentRuntime delegates the complete loop to the SDK and projects durable facts", async () => {
  const events = [];
  const capture = {};
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-"));
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "system", subtype: "init", session_id: "sdk-session", model: "claude-sonnet", tools: ["Write"], permissionMode: "acceptEdits", cwd: "C:/work" },
    { type: "assistant", session_id: "sdk-session", message: { content: [{ type: "tool_use", id: "tool-1", name: "Write", input: { file_path: "game.html", content: "<canvas/>" } }] } },
    { type: "user", session_id: "sdk-session", message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "created", is_error: false }] } },
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "游戏已完成", terminal_reason: "completed", num_turns: 2, duration_ms: 20, total_cost_usd: 0.01, permission_denials: [] }
  ], capture, () => writeFile(join(workspaceRoot, "game.html"), "<canvas/>", "utf8")) });

  const result = await runtime.run({
    sessionId: "session", runId: "run", task: "创建游戏", workspaceRoot, model: "claude-sonnet",
    reasoning: { enabled: true, effort: "max", supportedEfforts: ["high", "max"] },
    signal: new AbortController().signal, permissionMode: "auto", budgetPolicy, settingSources: ["project"],
    requestApproval: async () => "allow_once", appendEvent: async (_id, type, data) => events.push({ type, data })
  });

  assert.equal(result.state, "completed");
  assert.equal(capture.params.options.permissionMode, "acceptEdits");
  assert.equal(capture.params.options.cwd, workspaceRoot);
  assert.deepEqual(capture.params.options.settingSources, ["project"]);
  assert.deepEqual(capture.params.options.thinking, { type: "adaptive" });
  assert.equal(capture.params.options.effort, "max");
  assert.match(capture.params.options.systemPrompt.append, /Task 工具 ID 是跨轮次延续的不透明会话身份/);
  assert.equal(events.find((event) => event.type === "claude_sdk_session_initialized").data.sdkSessionId, "sdk-session");
  assert.equal(events.find((event) => event.type === "tool_requested").data.activity.semanticKey, "file.create");
  assert.equal(events.find((event) => event.type === "tool_result_recorded").data.toolCallId, "tool-1");
  const mutation = events.find((event) => event.type === "workspace_mutation_observed");
  assert.deepEqual(mutation.data.sourceToolCallIds, ["tool-1"]);
  assert.equal(mutation.data.fileChanges[0].path, "game.html");
  assert.equal(events.at(-1).type, "agent_final");
});

test("ClaudeAgentRuntime normalizes SDK task tools into replayable product facts", async () => {
  const events = [];
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "assistant", session_id: "sdk-session", message: { content: [{ type: "tool_use", id: "task-1", name: "TaskCreate", input: { subject: "检查项目", activeForm: "检查项目中" } }] } },
    { type: "user", session_id: "sdk-session", message: { content: [{ type: "tool_result", tool_use_id: "task-1", content: "Task #1 created successfully: 检查项目", is_error: false }] } },
    { type: "assistant", session_id: "sdk-session", message: { content: [{ type: "tool_use", id: "task-2", name: "TaskUpdate", input: { taskId: "1", status: "completed" } }] } },
    { type: "user", session_id: "sdk-session", message: { content: [{ type: "tool_result", tool_use_id: "task-2", content: "Updated task #1 status", is_error: false }] } },
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 2, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ]) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-tasks-"));
  await runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "ask", budgetPolicy,
    requestApproval: async () => "deny_task", appendEvent: async (_id, type, data) => events.push({ type, data })
  });
  const facts = events.filter((event) => event.type === "task_progress_changed").map((event) => event.data);
  assert.deepEqual(facts.map(({ operation, taskId }) => [operation, taskId]), [["create", "1"], ["update", "1"]]);
  assert.equal(facts[1].patch.status, "completed");
});

test("ClaudeAgentRuntime closes an unresolved SDK tool call when the run is cancelled", async () => {
  const events = [];
  const controller = new AbortController();
  controller.abort({ code: "USER_STOP", message: "用户停止了当前任务。" });
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "assistant", session_id: "sdk-session", message: { content: [{ type: "tool_use", id: "bash-1", name: "Bash", input: { command: "npm test" } }] } }
  ]) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-cancel-"));
  const result = await runtime.run({
    sessionId: "session", runId: "run", task: "运行测试", workspaceRoot,
    signal: controller.signal, permissionMode: "ask", budgetPolicy,
    requestApproval: async () => "allow_once", appendEvent: async (_id, type, data) => events.push({ type, data })
  });
  assert.equal(result.state, "cancelled");
  const cancelled = events.find((event) => event.type === "tool_cancelled");
  assert.equal(cancelled.data.toolCallId, "bash-1");
  assert.equal(cancelled.data.error.code, "USER_STOP");
});

test("ClaudeAgentRuntime rejects a mutation task when SDK success has no mutation evidence", async () => {
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 1, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ]) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-empty-"));
  await assert.rejects(() => runtime.run({
    sessionId: "session", runId: "run", task: "创建网页", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "ask", budgetPolicy, requestApproval: async () => "deny_task", appendEvent: async () => {}
  }), { code: "RUN_INCOMPLETE" });
});

test("ClaudeAgentRuntime disables thinking and omits unsupported effort", async () => {
  const capture = {};
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 1, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ], capture) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-reasoning-"));
  await runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    reasoning: { enabled: false, effort: "max", supportedEfforts: [] },
    signal: new AbortController().signal, permissionMode: "ask", budgetPolicy,
    requestApproval: async () => "deny_task", appendEvent: async () => {}
  });
  assert.deepEqual(capture.params.options.thinking, { type: "disabled" });
  assert.equal(capture.params.options.effort, undefined);
});

test("ClaudeAgentRuntime exposes SDK API retries instead of looking stuck", async () => {
  const events = [];
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "system", subtype: "init", session_id: "sdk-session", model: "kimi-k3", tools: [], permissionMode: "default", cwd: "C:/work" },
    { type: "system", subtype: "api_retry", session_id: "sdk-session", attempt: 1, max_retries: 3, retry_delay_ms: 2_000, error_status: 429, error: "daily token limit" },
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 1, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ]) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-retry-"));
  await runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "ask", budgetPolicy,
    requestApproval: async () => "deny_task", appendEvent: async (_id, type, data) => events.push({ type, data })
  });
  assert.equal(events.find((event) => event.type === "model_attempt_failed").data.category, "rate_limit");
  assert.equal(events.find((event) => event.type === "model_retry_scheduled").data.delayMs, 2_000);
  assert.equal(events.find((event) => event.type === "run_state_changed" && event.data.to === "retry_wait").data.owner, "claude_agent_sdk");
});

test("ClaudeAgentRuntime stops SDK retries immediately after credential rejection", async () => {
  const events = [];
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "system", subtype: "init", session_id: "sdk-session", model: "deepseek-v4-pro", tools: [], permissionMode: "default", cwd: "C:/work" },
    { type: "system", subtype: "api_retry", session_id: "sdk-session", attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 401, error: "authentication_failed" }
  ]) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-auth-"));
  await assert.rejects(() => runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "ask", budgetPolicy,
    requestApproval: async () => "deny_task", appendEvent: async (_id, type, data) => events.push({ type, data })
  }), { code: "authentication_failed", status: 401 });
  assert.equal(events.find((event) => event.type === "model_attempt_failed").data.category, "authentication");
  assert.equal(events.some((event) => event.type === "model_retry_scheduled"), false);
});

test("ClaudeAgentRuntime projects SDK compaction as a durable context event", async () => {
  const events = [];
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "system", subtype: "compact_boundary", session_id: "sdk-session", compact_metadata: { trigger: "auto", pre_tokens: 90_000, post_tokens: 18_000 } },
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 1, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ]) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-compact-"));
  await runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "ask", budgetPolicy,
    requestApproval: async () => "deny_task", appendEvent: async (_id, type, data) => events.push({ type, data })
  });
  assert.deepEqual(events.find((event) => event.type === "context_compacted").data, {
    reason: "sdk_auto", beforeEstimatedTokens: 90_000, afterEstimatedTokens: 18_000,
    source: "claude_agent_sdk", runId: "run"
  });
});

test("SDK permission bridge preserves CodePilot Skill tool scopes in full mode", async () => {
  const registry = new ToolRegistry([buildTool({
    name: "BrowserInspect",
    description: "Inspect browser",
    inputSchema: z.object({ sessionId: z.string() }).strict(),
    async call() { return toolSuccess("ok"); }
  })]);
  const runtimeState = { activeSkillScopes: [{ skill: "read-only", allowedTools: ["Read"] }] };
  let decision;
  const capture = {};
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 1, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ], capture, async () => {
    decision = await capture.params.options.canUseTool(
      "mcp__codepilot__BrowserInspect",
      { sessionId: "browser-1" },
      { toolUseID: "tool-1" }
    );
  }) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-scope-"));
  await runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "full", budgetPolicy,
    requestApproval: async () => "allow_once", appendEvent: async () => {},
    extensionToolRegistry: registry,
    extensionToolContext: () => ({ workspaceRoot, runtimeState })
  });
  assert.equal(capture.params.options.permissionMode, "acceptEdits");
  assert.equal(capture.params.options.allowDangerouslySkipPermissions, false);
  assert.equal(decision.behavior, "deny");
  assert.match(decision.message, /outside active Skill/);
});

test("SDK permission bridge preserves non-bypassable extension approval in full mode", async () => {
  const registry = new ToolRegistry([buildTool({
    name: "InstallSkill",
    description: "Install a Skill",
    inputSchema: z.object({ source: z.string() }).strict(),
    async checkPermissions() {
      return { decision: "ask", nonBypassable: true, summary: "Install Skill" };
    },
    async call() { return toolSuccess("installed"); }
  })]);
  const capture = {};
  let approvalRequests = 0;
  let decision;
  const runtime = new ClaudeAgentRuntime({ queryImpl: fakeQuery([
    { type: "result", subtype: "success", is_error: false, session_id: "sdk-session", result: "done", terminal_reason: "completed", num_turns: 1, duration_ms: 1, total_cost_usd: 0, permission_denials: [] }
  ], capture, async () => {
    decision = await capture.params.options.canUseTool(
      "mcp__codepilot__InstallSkill",
      { source: "fixtures/skill" },
      { toolUseID: "tool-install" }
    );
  }) });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-non-bypassable-"));
  await runtime.run({
    sessionId: "session", runId: "run", task: "explain status", workspaceRoot,
    signal: new AbortController().signal, permissionMode: "full", budgetPolicy,
    requestApproval: async () => {
      approvalRequests += 1;
      return "allow_once";
    },
    appendEvent: async () => {},
    extensionToolRegistry: registry,
    extensionToolContext: () => ({ workspaceRoot, runtimeState: {} })
  });
  assert.equal(approvalRequests, 1);
  assert.equal(decision.behavior, "allow");
});
