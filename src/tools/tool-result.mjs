export function toolSuccess(content, metadata = {}) {
  return { ok: true, content: String(content ?? ""), metadata };
}

export function withContextModifier(result, value) {
  return {
    ...result,
    contextModifier: {
      kind: "tool_result_summary",
      transient: true,
      value
    }
  };
}

export function withContextProjection(result, projection) {
  return {
    ...result,
    contextModifier: {
      kind: "context_projection",
      transient: true,
      value: projection
    }
  };
}

export function toolError(code, message, details = {}) {
  return {
    ok: false,
    content: "",
    error: { code, message, details }
  };
}

export function toolCancelled(message, {
  reason = "user_stop",
  code = "USER_STOP",
  executionStarted = false,
  sideEffect = executionStarted ? "unknown" : "none",
  ...details
} = {}) {
  return toolError("TOOL_CANCELLED", message, {
    reason,
    code,
    executionStarted,
    sideEffect,
    ...details
  });
}

export function isToolResult(value) {
  if (!value || typeof value !== "object" || typeof value.ok !== "boolean" || typeof value.content !== "string") return false;
  return value.ok || (typeof value.error?.code === "string" && typeof value.error?.message === "string");
}
