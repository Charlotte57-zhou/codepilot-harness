function numericStatus(error) {
  const status = Number(error?.status ?? error?.details?.status);
  return Number.isInteger(status) ? status : undefined;
}

function diagnosticCode(error) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const code = typeof current.code === "string" ? current.code.trim().toUpperCase() : "";
    if (code && !code.startsWith("MODEL_")) return /^[A-Z0-9_]+$/.test(code) ? code.slice(0, 80) : undefined;
    current = current.cause;
  }
  return undefined;
}

function networkReason(error, message) {
  const code = diagnosticCode(error);
  const evidence = `${code ?? ""} ${message}`;
  if (/\b(?:ENOBUFS|WSAENOBUFS)\b|buffer space|socket.*resource/i.test(evidence)) return { networkReason: "socket_exhausted", diagnosticCode: code };
  if (/\b(?:ENOTFOUND|EAI_AGAIN|EAI_FAIL|WSAHOST_NOT_FOUND)\b|getaddrinfo|name resolution/i.test(evidence)) return { networkReason: "dns", diagnosticCode: code };
  if (/\b(?:ECONNREFUSED)\b|connection refused/i.test(evidence)) return { networkReason: "connection_refused", diagnosticCode: code };
  if (/\b(?:ECONNRESET|EPIPE)\b|connection reset|socket hang up/i.test(evidence)) return { networkReason: "connection_reset", diagnosticCode: code };
  if (/\b(?:ENETUNREACH|EHOSTUNREACH)\b|network is unreachable|no route to host/i.test(evidence)) return { networkReason: "unreachable", diagnosticCode: code };
  if (/\b(?:ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT)\b|connect timeout/i.test(evidence)) return { networkReason: "connect_timeout", diagnosticCode: code };
  if (/\b(?:CERT_[A-Z0-9_]+|ERR_TLS_[A-Z0-9_]+|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE)\b|certificate|tls/i.test(evidence)) return { networkReason: "tls", diagnosticCode: code };
  return { networkReason: "unknown", diagnosticCode: code };
}

export function classifyModelError(error) {
  const status = numericStatus(error);
  const code = error?.code;
  const message = error instanceof Error ? error.message : String(error ?? "Unknown model error");
  const retryAfterMs = Number.isFinite(error?.retryAfterMs) ? error.retryAfterMs : undefined;

  if (code === "MODEL_CANCELLED") return { category: "cancelled", retryable: false, status, message };
  if (code === "EPERM" || code === "EACCES" || code === "EBUSY" || /operation not permitted|access denied|resource busy|rename .*\.index\.json/i.test(message)) {
    return { category: "storage", retryable: false, status, message, diagnosticCode: code };
  }
  if (code === "MODEL_CONTEXT_OVERFLOW" || status === 413 || /prompt.*long|context.*(?:length|window|limit)|maximum context|too many tokens/i.test(message)) {
    return { category: "context_overflow", retryable: false, status, message };
  }
  if (status === 401 || status === 403 || /api.?key|required|unauthori[sz]ed|forbidden/i.test(message)) return { category: "authentication", retryable: false, status, message };
  if (status === 429 || /rate.?limit|too many requests/i.test(message)) return { category: "rate_limit", retryable: true, status, message, retryAfterMs };
  if (status !== undefined && status >= 500) return { category: "service", retryable: true, status, message, retryAfterMs };
  if (code === "MODEL_TIMEOUT" || /timed out|timeout/i.test(message)) return { category: "timeout", retryable: true, status, message };
  if (code === "MODEL_NETWORK_ERROR" || /fetch failed|network|connection reset|econnreset|econnrefused/i.test(message)) {
    return { category: "network", retryable: true, status, message, ...networkReason(error, message) };
  }
  if (status !== undefined && status >= 400) return { category: "request", retryable: false, status, message };
  if (/schema|invalid request/i.test(message)) return { category: "request", retryable: false, status, message };
  return { category: "unknown", retryable: false, status, message };
}
