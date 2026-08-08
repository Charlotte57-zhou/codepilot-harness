const DEFAULT_MAX_RECEIPTS = 80;

function messageText(event) {
  const data = event?.data ?? {};
  if (event?.type === "user_message") return data.displayContent ?? data.content ?? "";
  if (event?.type === "agent_final") return data.summary ?? "";
  if (event?.type === "agent_error") return data.detail ?? data.message ?? "任务运行失败";
  if (event?.type === "agent_cancelled") return data.detail ?? "任务已停止";
  return "";
}

export function compactTurnPreview(value, limit = 260) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

export function buildConversationTurns(events) {
  const turns = [];
  let current = null;
  for (const event of events ?? []) {
    if (event?.type === "user_message") {
      current = {
        id: String(event.id ?? `turn-${turns.length + 1}`),
        index: turns.length,
        user: compactTurnPreview(messageText(event)),
        assistant: "正在等待模型回复"
      };
      turns.push(current);
      continue;
    }
    if (!current || !["agent_final", "agent_error", "agent_cancelled"].includes(event?.type)) continue;
    current.assistant = compactTurnPreview(messageText(event)) || current.assistant;
  }
  return turns;
}

export function restoreConversationViewports(serialized) {
  if (!serialized) return {};
  try {
    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([sessionId, receipt]) => (
      sessionId
      && receipt
      && typeof receipt === "object"
      && Number.isFinite(Number(receipt.scrollTop))
      && Number.isFinite(Number(receipt.updatedAt))
    )).map(([sessionId, receipt]) => [sessionId, {
      anchorId: typeof receipt.anchorId === "string" ? receipt.anchorId : null,
      anchorOffset: Number.isFinite(Number(receipt.anchorOffset)) ? Number(receipt.anchorOffset) : 0,
      scrollTop: Math.max(0, Number(receipt.scrollTop)),
      updatedAt: Number(receipt.updatedAt)
    }]));
  } catch {
    return {};
  }
}

export function updateConversationViewport(viewports, sessionId, receipt, { maxReceipts = DEFAULT_MAX_RECEIPTS } = {}) {
  if (!sessionId || !receipt) return { ...viewports };
  const next = {
    ...viewports,
    [sessionId]: {
      anchorId: typeof receipt.anchorId === "string" ? receipt.anchorId : null,
      anchorOffset: Number.isFinite(Number(receipt.anchorOffset)) ? Number(receipt.anchorOffset) : 0,
      scrollTop: Math.max(0, Number(receipt.scrollTop) || 0),
      updatedAt: Number.isFinite(Number(receipt.updatedAt)) ? Number(receipt.updatedAt) : Date.now()
    }
  };
  const entries = Object.entries(next).sort((left, right) => right[1].updatedAt - left[1].updatedAt);
  return Object.fromEntries(entries.slice(0, Math.max(1, maxReceipts)));
}

export function persistConversationViewports(viewports) {
  return JSON.stringify(viewports ?? {});
}
