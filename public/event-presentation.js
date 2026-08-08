const MODEL_CATEGORY_COPY = {
  cancelled: {
    label: "模型请求已取消",
    title: "模型请求已取消",
    detail: "任务停止后，正在进行的模型请求已结束。",
    tone: "cancelled"
  },
  authentication: {
    label: "模型鉴权失败",
    title: "模型鉴权失败",
    detail: "请检查 Provider、Base URL、模型名称和 API Key。",
    tone: "error"
  },
  rate_limit: {
    label: "模型服务限流",
    title: "模型服务限流",
    detail: "请求频率超过模型服务限制。",
    tone: "warning"
  },
  service: {
    label: "模型服务异常",
    title: "模型服务异常",
    detail: "模型服务暂时未正常响应。",
    tone: "error"
  },
  timeout: {
    label: "模型请求超时",
    title: "模型请求超时",
    detail: "模型服务在限定时间内没有完成响应。",
    tone: "warning"
  },
  network: {
    label: "模型连接中断",
    title: "模型连接中断",
    detail: "本地运行时与模型服务之间的网络连接中断。",
    tone: "warning"
  },
  storage: {
    label: "会话记录写入失败",
    title: "会话记录写入失败",
    detail: "任务内容已生成，但本地会话索引更新被系统文件锁或其他进程暂时阻止。",
    tone: "error"
  },
  context_overflow: {
    label: "上下文超过模型限制",
    title: "上下文超过模型限制",
    detail: "当前输入超过所选模型的上下文窗口。",
    tone: "error"
  },
  request: {
    label: "模型请求有误",
    title: "模型请求有误",
    detail: "模型服务拒绝了当前请求参数。",
    tone: "error"
  },
  unknown: {
    label: "模型请求异常",
    title: "模型请求异常",
    detail: "模型请求遇到尚未分类的异常。",
    tone: "error"
  }
};

const RUN_STATE_COPY = {
  preparing: { label: "正在准备", tone: "active" },
  sampling: { label: "正在请求模型", tone: "active" },
  streaming: { label: "正在接收模型输出", tone: "active" },
  executing_tools: { label: "正在执行工具", tone: "active" },
  awaiting_permission: { label: "正在等待批准", tone: "warning" },
  completed: { label: "任务已完成", tone: "success" },
  failed: { label: "任务运行失败", tone: "error" },
  cancelled: { label: "任务已停止", tone: "cancelled" }
};

const NETWORK_REASON_COPY = {
  dns: {
    label: "DNS 解析失败",
    title: "DNS 解析失败",
    detail: "本机未能解析模型服务域名，请检查 DNS、代理或系统网络资源。"
  },
  socket_exhausted: {
    label: "系统网络资源不足",
    title: "系统网络资源不足",
    detail: "本机套接字资源接近耗尽，新的模型网络连接未能建立。"
  },
  connection_refused: {
    label: "模型连接被拒绝",
    title: "模型连接被拒绝",
    detail: "目标地址已解析，但模型服务或代理拒绝了连接。"
  },
  connection_reset: {
    label: "模型连接被重置",
    title: "模型连接被重置",
    detail: "连接已建立，但被模型服务、代理或中间网络提前关闭。"
  },
  unreachable: {
    label: "模型网络不可达",
    title: "模型网络不可达",
    detail: "本机当前没有到模型服务地址的可用网络路径。"
  },
  connect_timeout: {
    label: "模型连接超时",
    title: "模型连接超时",
    detail: "域名已进入连接阶段，但在限定时间内没有建立连接。"
  },
  tls: {
    label: "TLS 连接失败",
    title: "TLS 连接失败",
    detail: "模型服务的加密连接或证书校验没有通过。"
  }
};

function meaningfulMessage(data, fallback) {
  const message = typeof data?.message === "string" ? data.message.trim() : "";
  if (!message
    || (data?.category === "cancelled" && /cancelled|canceled|abort/i.test(message))
    || (data?.category === "network" && /^(?:Model network request failed|fetch failed)$/i.test(message))) return fallback;
  return message;
}

export function presentModelAttempt(event) {
  const data = event?.data ?? {};
  const category = data.category ?? "unknown";
  const base = category === "network" && NETWORK_REASON_COPY[data.networkReason]
    ? { ...MODEL_CATEGORY_COPY.network, ...NETWORK_REASON_COPY[data.networkReason] }
    : MODEL_CATEGORY_COPY[category] ?? MODEL_CATEGORY_COPY.unknown;
  if (event?.type === "model_retry_scheduled") {
    const delay = Number.isFinite(data.delayMs) ? `，${data.delayMs} ms 后` : "";
    const attempt = Number.isFinite(data.nextAttempt) && Number.isFinite(data.maxAttempts)
      ? `进行第 ${data.nextAttempt}/${data.maxAttempts} 次尝试`
      : "再次尝试";
    return {
      label: "模型请求重试",
      title: `${base.title}，准备重试`,
      detail: `${base.detail}${delay}${attempt}。`,
      tone: "warning",
      category,
      terminal: false
    };
  }
  const retryable = data.retryable === true;
  return {
    label: base.label,
    title: retryable ? `${base.title}，本次未成功` : base.title,
    detail: meaningfulMessage(data, base.detail),
    tone: retryable ? "warning" : base.tone,
    category,
    terminal: !retryable
  };
}

export function presentAgentError(event) {
  const data = event?.data ?? {};
  if (data.category === "cancelled") {
    return {
      label: "任务已停止",
      title: "任务已停止",
      detail: "用户停止了当前任务。",
      tone: "cancelled"
    };
  }
  if (data.category && data.category !== "unknown") {
    const model = presentModelAttempt({ type: "model_attempt_failed", data: { ...data, retryable: false } });
    return { ...model, label: model.title };
  }
  return {
    label: "任务运行失败",
    title: "任务运行失败",
    detail: meaningfulMessage(data, "运行时遇到尚未分类的异常。"),
    tone: "error"
  };
}

export function presentRunState(data = {}) {
  const base = RUN_STATE_COPY[data.to] ?? { label: data.to ?? "运行状态已更新", tone: "neutral" };
  if (data.to === "cancelled") {
    const reason = data.reason ?? data.cancellation?.reason;
    if (["interactive_session_lost", "browser_disconnected", "heartbeat_timeout"].includes(reason)) {
      return { label: "交互连接已中断", tone: "cancelled" };
    }
  }
  return base;
}

export function presentToolCompletion(event) {
  const data = event?.data ?? {};
  const code = data.error?.code;
  if (event?.type === "tool_cancelled") return { label: "已取消", tone: "cancelled", outcome: "cancelled" };
  if (data.ok !== false) return { label: "已完成", tone: "success", outcome: "completed" };
  if (code === "PERMISSION_DENIED") return { label: "未批准", tone: "neutral", outcome: "not_run" };
  if (code === "PATH_NOT_FOUND") return { label: "路径未找到", tone: "error", outcome: "failed" };
  if (code === "SCHEMA_VALIDATION_FAILED") return { label: "参数有误", tone: "error", outcome: "failed" };
  if (code === "BASH_COMMAND_NOT_ALLOWLISTED") return { label: "策略拦截", tone: "neutral", outcome: "not_run" };
  return { label: "执行失败", tone: "error", outcome: "failed" };
}

function sameModelTurn(left, right) {
  const leftRunId = left?.data?.runId;
  const rightRunId = right?.data?.runId;
  if (leftRunId && rightRunId && leftRunId !== rightRunId) return false;
  const leftTurn = left?.data?.turn;
  const rightTurn = right?.data?.turn;
  return leftTurn == null || rightTurn == null || leftTurn === rightTurn;
}

export function projectModelRequest(requestEvent, events, { now = Date.now() } = {}) {
  const startedAt = new Date(requestEvent.timestamp).getTime();
  const following = events.filter((event) => new Date(event.timestamp).getTime() >= startedAt && sameModelTurn(requestEvent, event));
  const response = following.find((event) => event.type === "model_response_received");
  const failures = following.filter((event) => event.type === "model_attempt_failed");
  const latestFailure = failures.at(-1);
  const runTerminal = events.find((event) => event.type === "run_state_changed"
    && event.data?.runId === requestEvent.data?.runId
    && ["failed", "cancelled"].includes(event.data?.to)
    && new Date(event.timestamp).getTime() >= startedAt);
  const terminal = response ?? (latestFailure && latestFailure.data?.retryable !== true ? latestFailure : undefined) ?? runTerminal;
  const end = terminal ? new Date(terminal.timestamp).getTime() : now;
  const elapsedMs = Math.max(0, end - startedAt);

  if (response) return { outcome: "completed", title: "模型调用完成", detail: "模型响应已收到", tone: "success", elapsedMs, terminal: true };
  if (latestFailure?.data?.category === "cancelled" || runTerminal?.data?.to === "cancelled") {
    return { outcome: "cancelled", title: "模型调用已停止", detail: "任务停止后，模型请求已取消", tone: "cancelled", elapsedMs, terminal: true };
  }
  if (latestFailure && latestFailure.data?.retryable !== true) {
    const presentation = presentModelAttempt(latestFailure);
    return { outcome: "failed", title: presentation.title, detail: presentation.detail, tone: presentation.tone, elapsedMs, terminal: true };
  }
  if (runTerminal?.data?.to === "failed") return { outcome: "failed", title: "模型调用未完成", detail: runTerminal.data.detail ?? "任务运行失败", tone: "error", elapsedMs, terminal: true };
  if (latestFailure?.data?.retryable === true) {
    const presentation = presentModelAttempt(latestFailure);
    return { outcome: "retrying", title: "正在重试模型请求", detail: presentation.detail, tone: "warning", elapsedMs, terminal: false };
  }
  return {
    outcome: "pending",
    title: `正在调用 ${requestEvent.data?.provider ?? "模型"}`,
    detail: requestEvent.data?.detail ?? "正在等待模型响应",
    tone: "active",
    elapsedMs,
    terminal: false
  };
}
