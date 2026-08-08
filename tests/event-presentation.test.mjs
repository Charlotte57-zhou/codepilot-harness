import test from "node:test";
import assert from "node:assert/strict";

import {
  presentAgentError,
  presentModelAttempt,
  presentRunState,
  presentToolCompletion,
  projectModelRequest
} from "../public/event-presentation.js";

const event = (type, timestamp, data = {}) => ({ type, timestamp, data });

test("a user-stopped model request is presented as cancellation rather than failure", () => {
  const presentation = presentModelAttempt(event("model_attempt_failed", "2026-07-20T15:35:38.437Z", {
    category: "cancelled",
    message: "Model request was cancelled",
    retryable: false
  }));

  assert.deepEqual(presentation, {
    label: "模型请求已取消",
    title: "模型请求已取消",
    detail: "任务停止后，正在进行的模型请求已结束。",
    tone: "cancelled",
    category: "cancelled",
    terminal: true
  });
});

test("retryable attempts are warnings while terminal categories retain their cause", () => {
  assert.equal(presentModelAttempt(event("model_attempt_failed", "2026-07-20T10:00:00Z", {
    category: "rate_limit",
    retryable: true
  })).title, "模型服务限流，本次未成功");
  assert.equal(presentModelAttempt(event("model_attempt_failed", "2026-07-20T10:00:00Z", {
    category: "authentication",
    retryable: false
  })).title, "模型鉴权失败");
  assert.equal(presentModelAttempt(event("model_attempt_failed", "2026-07-20T10:00:00Z", {
    category: "context_overflow",
    retryable: false
  })).title, "上下文超过模型限制");
});

test("network attempts project sanitized transport diagnostics into precise user copy", () => {
  const dns = presentModelAttempt(event("model_attempt_failed", "2026-07-21T05:58:42.670Z", {
    category: "network",
    networkReason: "dns",
    diagnosticCode: "ENOTFOUND",
    message: "Model network request failed",
    retryable: true
  }));
  assert.equal(dns.title, "DNS 解析失败，本次未成功");
  assert.equal(dns.detail, "本机未能解析模型服务域名，请检查 DNS、代理或系统网络资源。");

  const tls = presentModelAttempt(event("model_attempt_failed", "2026-07-21T05:58:42.670Z", {
    category: "network",
    networkReason: "tls",
    retryable: false
  }));
  assert.equal(tls.title, "TLS 连接失败");
});

test("unknown agent errors are runtime failures rather than invented model failures", () => {
  assert.deepEqual(presentAgentError(event("agent_error", "2026-07-20T10:00:00Z", {
    category: "unknown",
    message: "EPERM rename index.json.tmp"
  })), {
    label: "任务运行失败",
    title: "任务运行失败",
    detail: "EPERM rename index.json.tmp",
    tone: "error"
  });
});

test("session index write failures are presented as local persistence errors", () => {
  const presentation = presentAgentError(event("agent_error", "2026-07-21T10:00:00Z", {
    category: "storage",
    message: "EPERM: operation not permitted, rename index.json.tmp -> index.json"
  }));
  assert.equal(presentation.title, "会话记录写入失败");
  assert.equal(presentation.detail, "EPERM: operation not permitted, rename index.json.tmp -> index.json");
});

test("tool outcomes distinguish rejection, cancellation, policy blocking and execution failure", () => {
  assert.deepEqual(presentToolCompletion(event("tool_completed", "2026-07-20T10:00:00Z", {
    ok: false,
    error: { code: "PERMISSION_DENIED" }
  })), { label: "未批准", tone: "neutral", outcome: "not_run" });
  assert.deepEqual(presentToolCompletion(event("tool_cancelled", "2026-07-20T10:00:00Z", {
    ok: false
  })), { label: "已取消", tone: "cancelled", outcome: "cancelled" });
  assert.equal(presentToolCompletion(event("tool_completed", "2026-07-20T10:00:00Z", {
    ok: false,
    error: { code: "BASH_COMMAND_NOT_ALLOWLISTED" }
  })).label, "策略拦截");
  assert.equal(presentToolCompletion(event("tool_completed", "2026-07-20T10:00:00Z", {
    ok: false,
    error: { code: "BASH_EXIT_NONZERO" }
  })).label, "执行失败");
});

test("model request projection is scoped to the same run and turn", () => {
  const request = event("model_request_started", "2026-07-20T10:00:00.000Z", { runId: "run-a", turn: 1, provider: "deepseek" });
  const projection = projectModelRequest(request, [
    request,
    event("agent_error", "2026-07-20T10:00:00.500Z", { runId: "run-b", category: "unknown" }),
    event("model_response_received", "2026-07-20T10:00:01.000Z", { runId: "run-a", turn: 1 })
  ]);

  assert.equal(projection.outcome, "completed");
  assert.equal(projection.title, "模型调用完成");
  assert.equal(projection.elapsedMs, 1000);
});

test("terminal cancelled run stops an in-flight model request without error semantics", () => {
  const request = event("model_request_started", "2026-07-20T10:00:00.000Z", { runId: "run-a", turn: 3, provider: "deepseek" });
  const projection = projectModelRequest(request, [
    request,
    event("model_attempt_failed", "2026-07-20T10:00:01.000Z", { runId: "run-a", turn: 3, category: "cancelled", retryable: false }),
    event("run_state_changed", "2026-07-20T10:00:01.010Z", { runId: "run-a", to: "cancelled" })
  ]);

  assert.equal(projection.outcome, "cancelled");
  assert.equal(projection.title, "模型调用已停止");
  assert.equal(projection.tone, "cancelled");
});

test("run state copy separates failure, user stop and connection loss", () => {
  assert.equal(presentRunState({ to: "failed" }).label, "任务运行失败");
  assert.equal(presentRunState({ to: "cancelled" }).label, "任务已停止");
  assert.equal(presentRunState({ to: "cancelled", reason: "heartbeat_timeout" }).label, "交互连接已中断");
});
