export function formatBudgetNotice(event, { live = false } = {}) {
  const data = event?.data ?? {};
  if (event?.type === "run_budget_exceeded") return data.message ?? "任务达到运行上限。";
  if (data.kind === "turns" && Number.isFinite(data.used) && Number.isFinite(data.limit)) {
    return live
      ? `预算提醒：本轮已使用 ${data.used}/${data.limit} 个模型回合。`
      : `预算记录：本轮在使用 ${data.used}/${data.limit} 个模型回合时触发提醒。`;
  }
  if (data.kind === "retries" && Number.isFinite(data.used) && Number.isFinite(data.limit)) {
    return live
      ? `预算提醒：本轮已使用 ${data.used}/${data.limit} 次模型重试。`
      : `预算记录：本轮在使用 ${data.used}/${data.limit} 次模型重试时触发提醒。`;
  }
  if (data.kind === "deadline" && Number.isFinite(data.remainingMs)) {
    const seconds = Math.max(0, Math.ceil(data.remainingMs / 1_000));
    return live
      ? `预算提醒：本轮剩余运行时间约 ${seconds} 秒。`
      : `预算记录：本轮在剩余运行时间约 ${seconds} 秒时触发提醒。`;
  }
  return data.message ?? "运行预算提醒。";
}

export function formatRunSummary(run, { live = false, elapsed = "0 秒" } = {}) {
  const processed = `已处理 ${elapsed} · ${run.toolResultCount} 个工具结果`;
  if (run.state === "completed") return { state: "任务已完成", meta: processed };
  if (run.state === "failed" && run.budgetExceeded) {
    return { state: "任务达到运行上限", meta: run.budgetExceeded.message ?? processed };
  }
  if (run.state === "failed") {
    const failure = presentAgentError({ type: "agent_error", data: run.terminalData ?? {} });
    return { state: failure.title, meta: failure.detail ?? processed };
  }
  if (run.state === "cancelled") {
    const reason = run.terminalData?.reason ?? run.terminalData?.cancellation?.reason;
    const disconnected = ["interactive_session_lost", "browser_disconnected", "heartbeat_timeout"].includes(reason);
    return { state: disconnected ? "交互连接已中断" : "任务已停止", meta: processed };
  }
  if (run.state === "orphaned") {
    return { state: "任务已中断（应用重启）", meta: processed };
  }
  if (run.budgetExceeded) return { state: "任务达到运行上限", meta: run.budgetExceeded.message ?? processed };
  if (live && run.budgetWarning) {
    return {
      state: formatBudgetNotice({ type: "run_budget_warning", data: run.budgetWarning }, { live: true }),
      meta: processed
    };
  }
  return live
    ? { state: "正在处理", meta: processed }
    : { state: `已处理 ${elapsed}`, meta: `${run.analysisCount} 次分析 · ${run.toolResultCount} 个工具结果` };
}
import { presentAgentError } from "./event-presentation.js";
