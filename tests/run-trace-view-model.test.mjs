import test from "node:test";
import assert from "node:assert/strict";
import { buildRunTraceViewModel, summarizeToolExecutions } from "../public/run-trace-view-model.js";

const event = (id, type, timestamp, data = {}) => ({
  id,
  type,
  timestamp,
  data: { batchId: data.batchId ?? `batch-${data.toolCallId ?? data.turn ?? "current"}`, ...data }
});

test("run trace streams public progress text and replaces deltas with the durable reasoning summary", () => {
  const partial = [
    event("1", "model_text_delta", "2026-07-20T10:00:00.000Z", { turn: 1, text: "我会先检查" }),
    event("2", "model_text_delta", "2026-07-20T10:00:00.100Z", { turn: 1, text: "运行链路。" })
  ];
  const live = buildRunTraceViewModel(partial, { live: true });
  assert.deepEqual(live.activities.map(({ kind, text, streaming }) => ({ kind, text, streaming })), [
    { kind: "reasoning", text: "我会先检查运行链路。", streaming: true }
  ]);

  const settled = buildRunTraceViewModel([
    ...partial,
    event("3", "agent_reasoning", "2026-07-20T10:00:00.200Z", { turn: 1, summary: "我会先检查运行链路。" })
  ], { live: true });
  assert.deepEqual(settled.activities.map(({ kind, text, streaming }) => ({ kind, text, streaming })), [
    { kind: "reasoning", text: "我会先检查运行链路。", streaming: false }
  ]);
});

test("completed run preserves each tool-linked execution explanation in event order", () => {
  const trace = buildRunTraceViewModel([
    event("1", "model_text_delta", "2026-07-20T10:00:00.000Z", { turn: 1, text: "先检查项目结构。" }),
    event("2", "tool_requested", "2026-07-20T10:00:00.100Z", { turn: 2, toolCallId: "read-1", tool: "Read", input: { file_path: "package.json" } }),
    event("3", "tool_completed", "2026-07-20T10:00:00.200Z", { toolCallId: "read-1", tool: "Read", ok: true }),
    event("4", "model_text_delta", "2026-07-20T10:00:01.000Z", { turn: 3, text: "接着运行针对性测试。" }),
    event("5", "tool_requested", "2026-07-20T10:00:01.100Z", { turn: 4, toolCallId: "bash-1", tool: "Bash", input: { command: "npm test" } }),
    event("6", "tool_completed", "2026-07-20T10:00:02.000Z", { toolCallId: "bash-1", tool: "Bash", ok: true }),
    event("7", "model_text_delta", "2026-07-20T10:00:03.000Z", { turn: 5, text: "这是最终回答，不应在运行详情里重复。" }),
    event("8", "agent_final", "2026-07-20T10:00:03.100Z", { summary: "这是最终回答，不应在运行详情里重复。" })
  ]);

  assert.deepEqual(trace.activities.map((activity) => activity.kind), [
    "reasoning", "tool_batch", "reasoning", "tool_batch"
  ]);
  assert.deepEqual(
    trace.activities.filter((activity) => activity.kind === "reasoning").map((activity) => activity.text),
    ["先检查项目结构。", "接着运行针对性测试。"]
  );
  assert.equal(trace.activities.some((activity) => activity.text?.includes("最终回答")), false);
});

test("failed run preserves its last public explanation when no final answer exists", () => {
  const trace = buildRunTraceViewModel([
    event("1", "model_text_delta", "2026-07-20T10:00:00.000Z", { turn: 1, text: "检查失败原因。" }),
    event("2", "run_state_changed", "2026-07-20T10:00:01.000Z", { to: "failed" })
  ]);

  assert.equal(trace.activities[0].text, "检查失败原因。");
});

test("completed execution explanation keeps content beyond the old 420 character boundary", () => {
  const explanation = `先分析。${"保留完整步骤说明。".repeat(60)}`;
  const trace = buildRunTraceViewModel([
    event("1", "model_text_delta", "2026-07-20T10:00:00.000Z", { turn: 1, text: explanation }),
    event("2", "tool_requested", "2026-07-20T10:00:00.100Z", { turn: 1, toolCallId: "read-1", tool: "Read" })
  ]);

  assert.equal(trace.activities[0].text, explanation);
  assert.ok(trace.activities[0].text.length > 420);
});

test("run trace projects resumed SDK task ids through current-run task ownership", () => {
  const trace = buildRunTraceViewModel([
    event("1", "model_text_delta", "2026-07-20T10:00:00.000Z", {
      runId: "run", turn: 1, text: "**任务 4/5：列出 tests 目录**"
    })
  ], {
    live: true,
    todo: {
      total: 2,
      todos: [
        { id: "4", displayOrdinal: 1 },
        { id: "5", displayOrdinal: 2 }
      ]
    }
  });

  assert.equal(trace.activities[0].text, "**任务 1/2：列出 tests 目录**");
});

test("run trace folds adjacent SDK tool turns into one semantic summary", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_requested", "2026-07-20T10:00:00.000Z", { turn: 1, toolCallId: "bash-1", tool: "Bash", input: { command: "npm test" } }),
    event("2", "tool_completed", "2026-07-20T10:00:01.000Z", { turn: 1, toolCallId: "bash-1", tool: "Bash", ok: true }),
    event("3", "tool_requested", "2026-07-20T10:00:02.000Z", { turn: 2, toolCallId: "edit-1", tool: "Edit", input: { file_path: "src/a.js" } }),
    event("4", "tool_completed", "2026-07-20T10:00:03.000Z", { turn: 2, toolCallId: "edit-1", tool: "Edit", ok: true })
  ]);
  assert.equal(trace.activities.length, 1);
  assert.equal(trace.activities[0].label, "运行了命令并编辑了 a.js");
  assert.equal(trace.activities[0].executions.length, 2);
});

test("context compaction separates tool groups and stays visible as a concise activity", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_requested", "2026-07-20T10:00:00.000Z", { turn: 1, toolCallId: "read-1", tool: "Read", input: { file_path: "a.js" } }),
    event("2", "context_compacted", "2026-07-20T10:00:01.000Z", { reason: "sdk_auto" }),
    event("3", "tool_requested", "2026-07-20T10:00:02.000Z", { turn: 2, toolCallId: "bash-1", tool: "Bash", input: { command: "npm test" } })
  ]);
  assert.deepEqual(trace.activities.map(({ kind }) => kind), ["tool_batch", "compact", "tool_batch"]);
});

test("tool summaries omit task bookkeeping from the visible operation count", () => {
  const request = (tool, input = {}) => ({ request: { data: { tool, input } } });
  const summary = summarizeToolExecutions([
    request("TaskUpdate"), request("Bash", { command: "npm test" }), request("Write", { file_path: "index.html" })
  ]);
  assert.equal(summary.label, "正在运行命令并编辑 index.html");
  assert.equal(summary.count, 2);
});

test("SDK completions correlate by tool call id even when completion has no turn or batch id", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_requested", "2026-07-20T10:00:00.000Z", { turn: 3, toolCallId: "read-1", tool: "Read", input: { file_path: "a.js" } }),
    event("2", "tool_completed", "2026-07-20T10:00:01.000Z", { toolCallId: "read-1", tool: "Read", ok: true })
  ]);
  assert.equal(trace.activities[0].executions[0].completion?.data.ok, true);
});

test("cross-stage narrative uses natural conjunctions and keeps failure truth", () => {
  const execution = (tool, input, completion = { type: "tool_completed", data: { ok: true } }) => ({
    request: { data: { tool, input } }, completion
  });
  const summary = summarizeToolExecutions([
    execution("Edit", { file_path: "src/app.js" }),
    execution("Bash", { command: "npm test" }),
    execution("Bash", { command: "npm run lint" }, { type: "tool_completed", data: { ok: false } }),
    execution("BrowserInspect", {})
  ]);
  assert.equal(summary.label, "编辑了 app.js、运行了 2 个命令并检查了界面，其中 1 项失败");
  assert.equal(summary.failed, 1);
});

test("run trace groups tool requests and results by durable batch id", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_batch_started", "2026-07-20T10:00:00.000Z", { batchId: "batch-1", presentation: { label: "读取了 2 个文件" } }),
    event("2", "tool_requested", "2026-07-20T10:00:00.010Z", { batchId: "batch-1", toolCallId: "read-1", tool: "Read" }),
    event("3", "tool_requested", "2026-07-20T10:00:00.020Z", { batchId: "batch-1", toolCallId: "read-2", tool: "Read" }),
    event("4", "tool_completed", "2026-07-20T10:00:00.030Z", { batchId: "batch-1", toolCallId: "read-1", ok: true }),
    event("5", "tool_completed", "2026-07-20T10:00:00.040Z", { batchId: "batch-1", toolCallId: "read-2", ok: true }),
    event("6", "tool_batch_completed", "2026-07-20T10:00:00.050Z", { batchId: "batch-1", presentation: { label: "读取了 2 个文件" } })
  ]);

  assert.equal(trace.activities.length, 1);
  assert.equal(trace.activities[0].label, "检查了 2 项代码");
  assert.equal(trace.activities[0].executions.length, 2);
  assert.equal(trace.activities[0].executions.every((execution) => execution.completion?.data.ok), true);
});

test("run trace attaches SDK workspace mutations to file operations with diff stats", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_requested", "2026-07-20T10:00:00.000Z", { runId: "run", turn: 1, toolCallId: "write-1", tool: "Write", input: { file_path: "src/a.js" } }),
    event("2", "tool_completed", "2026-07-20T10:00:01.000Z", { runId: "run", toolCallId: "write-1", tool: "Write", ok: true }),
    event("3", "workspace_mutation_observed", "2026-07-20T10:00:01.100Z", {
      runId: "run",
      sourceToolCallIds: ["write-1"],
      fileChanges: [{ path: "src/a.js", operation: "create", before: { exists: false, content: "" }, after: { exists: true, content: "one\ntwo" } }]
    })
  ]);
  const operation = trace.activities[0].executions[0].operation;
  assert.equal(operation.kind, "file");
  assert.equal(operation.status, "completed");
  assert.deepEqual(operation.files[0], { path: "src/a.js", changeKind: "create", additions: 2, deletions: 0 });
  assert.deepEqual(operation.sourceEventIds, ["1", "2", "3"]);
});

test("run trace prefers execution duration and preserves request order", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_requested", "2026-07-20T10:00:00.000Z", { batchId: "b", toolCallId: "a", tool: "Bash", input: { command: "first" } }),
    event("2", "tool_requested", "2026-07-20T10:00:00.010Z", { batchId: "b", toolCallId: "b", tool: "Bash", input: { command: "second" } }),
    event("3", "tool_completed", "2026-07-20T10:00:00.100Z", { batchId: "b", toolCallId: "b", tool: "Bash", ok: true }),
    event("4", "tool_completed", "2026-07-20T10:00:02.000Z", { batchId: "b", toolCallId: "a", tool: "Bash", ok: true, metadata: { execution: { durationMs: 321, exitCode: 0 } } })
  ]);
  assert.deepEqual(trace.activities[0].executions.map((item) => item.operation.command.text), ["first", "second"]);
  assert.equal(trace.activities[0].executions[0].operation.durationMs, 321);
  assert.equal(trace.activities[0].executions[0].operation.durationSource, "execution");
});

test("operation v2 distinguishes declined, policy not-run and file-change truth", () => {
  const trace = buildRunTraceViewModel([
    event("1", "tool_requested", "2026-07-20T10:00:00.000Z", { batchId: "b", toolCallId: "write", tool: "Write", input: { file_path: "existing.js" } }),
    event("2", "tool_completed", "2026-07-20T10:00:01.000Z", { batchId: "b", toolCallId: "write", ok: true, metadata: { fileChange: { path: "existing.js", operation: "edit", before: { exists: true, content: "a" }, after: { exists: true, content: "b" } } } }),
    event("3", "tool_requested", "2026-07-20T10:00:02.000Z", { batchId: "b", toolCallId: "deny", tool: "Bash", input: { command: "npm install" } }),
    event("4", "tool_completed", "2026-07-20T10:00:03.000Z", { batchId: "b", toolCallId: "deny", ok: false, error: { code: "PERMISSION_DENIED" } }),
    event("5", "tool_requested", "2026-07-20T10:00:04.000Z", { batchId: "b", toolCallId: "policy", tool: "Bash", input: { command: "blocked" } }),
    event("6", "tool_completed", "2026-07-20T10:00:05.000Z", { batchId: "b", toolCallId: "policy", ok: false, error: { code: "BASH_COMMAND_NOT_ALLOWLISTED" } })
  ]);
  const operations = trace.activities[0].executions.map(({ operation }) => operation);
  assert.equal(operations[0].version, 2);
  assert.equal(operations[0].semanticKey, "file.edit");
  assert.equal(operations[0].presentation.title, "已编辑文件");
  assert.deepEqual(operations.map(({ status }) => status), ["completed", "declined", "not_run"]);
});
