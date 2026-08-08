import test from "node:test";
import assert from "node:assert/strict";

import { formatBudgetNotice, formatRunSummary } from "../public/run-summary-view-model.js";

test("a completed run is not summarized by a stale budget warning", () => {
  const summary = formatRunSummary({
    state: "completed",
    toolResultCount: 8,
    analysisCount: 9,
    budgetWarning: {
      kind: "turns",
      used: 9,
      limit: 12,
      message: "任务接近运行上限，正在收敛结果。"
    }
  }, { live: false, elapsed: "48 秒" });

  assert.deepEqual(summary, {
    state: "任务已完成",
    meta: "已处理 48 秒 · 8 个工具结果"
  });
});

test("structured budget data replaces old present-tense warning text", () => {
  const event = {
    type: "run_budget_warning",
    data: {
      kind: "turns",
      used: 9,
      limit: 12,
      message: "任务接近运行上限，正在收敛结果。"
    }
  };
  assert.equal(formatBudgetNotice(event, { live: true }), "预算提醒：本轮已使用 9/12 个模型回合。");
  assert.equal(formatBudgetNotice(event, { live: false }), "预算记录：本轮在使用 9/12 个模型回合时触发提醒。");
});

test("budget exceeded remains authoritative for a failed run", () => {
  const summary = formatRunSummary({
    state: "failed",
    toolResultCount: 4,
    analysisCount: 12,
    budgetExceeded: { message: "Run exceeded the maximum of 12 turns" }
  }, { live: false, elapsed: "2 分 10 秒" });
  assert.deepEqual(summary, {
    state: "任务达到运行上限",
    meta: "Run exceeded the maximum of 12 turns"
  });
});

test("cancelled and unknown failures retain distinct terminal semantics", () => {
  assert.equal(formatRunSummary({
    state: "cancelled",
    toolResultCount: 2,
    terminalData: { reason: "user_stop" }
  }, { elapsed: "9 秒" }).state, "任务已停止");

  assert.equal(formatRunSummary({
    state: "cancelled",
    toolResultCount: 2,
    terminalData: { reason: "heartbeat_timeout" }
  }, { elapsed: "9 秒" }).state, "交互连接已中断");

  assert.deepEqual(formatRunSummary({
    state: "failed",
    toolResultCount: 0,
    terminalData: { category: "unknown", message: "EPERM rename index" }
  }, { elapsed: "1 秒" }), {
    state: "任务运行失败",
    meta: "EPERM rename index"
  });
});
