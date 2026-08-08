import { randomUUID } from "node:crypto";
import { attachmentKindForMediaType, mergeMessageTextAndAttachments } from "./attachment-protocol.mjs";
import { normalizeModelCapabilities } from "./model-capabilities.mjs";
import { resolveModelCapabilities } from "./provider-catalog.mjs";

export class AuxiliaryModelRequestError extends Error {
  constructor(message, { code, status, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AuxiliaryModelRequestError";
    this.code = code;
    this.status = status;
  }
}

function safeErrorDetail(body) {
  try {
    const payload = JSON.parse(body);
    const detail = payload?.error?.message ?? payload?.message;
    return typeof detail === "string"
      ? detail.replace(/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s,;}]+/gi, "$1=[REDACTED]").slice(0, 500)
      : undefined;
  } catch {
    return undefined;
  }
}

function controllerFor(signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason ?? { code: "MODEL_CANCELLED" });
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort({ code: "MODEL_TIMEOUT" }), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  };
}

function uploaded(message, kind) {
  return (message.attachments ?? []).filter((attachment) => (
    attachment?.origin === "upload"
    && (attachment.kind ?? attachmentKindForMediaType(attachment.mediaType)) === kind
  ));
}

function anthropicContent(message, capabilities) {
  const text = mergeMessageTextAndAttachments(message, capabilities);
  const images = capabilities.input.image ? uploaded(message, "image") : [];
  const pdfs = capabilities.input.pdf ? uploaded(message, "pdf") : [];
  if (!images.length && !pdfs.length) return text;
  return [
    ...(text ? [{ type: "text", text }] : []),
    ...images.map((attachment) => ({ type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.data } })),
    ...pdfs.map((attachment) => ({ type: "document", source: { type: "base64", media_type: "application/pdf", data: attachment.data } }))
  ];
}

export class ProviderAuxiliaryClient {
  constructor({ apiKey, baseUrl, model, authMode = "api_key", timeoutMs = 60_000, fetchImpl = fetch, capabilities }) {
    if (!apiKey || !baseUrl || !model) throw new TypeError("ProviderAuxiliaryClient requires apiKey, baseUrl, and model");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.authMode = authMode;
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
    this.capabilities = normalizeModelCapabilities(capabilities ?? resolveModelCapabilities("anthropic", model));
    this.providerName = "ProviderAuxiliaryClient";
  }

  async complete(request) {
    const controller = controllerFor(request.signal, this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.authMode === "auth_token" ? { authorization: `Bearer ${this.apiKey}` } : { "x-api-key": this.apiKey }),
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: request.maxOutputTokens ?? 1_000,
          system: request.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n"),
          messages: request.messages.filter((message) => message.role !== "system").map((message) => ({
            role: message.role,
            content: anthropicContent(message, this.capabilities)
          }))
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const detail = safeErrorDetail(await response.text());
        throw new AuxiliaryModelRequestError(
          `Auxiliary model request failed with status ${response.status}${detail ? `: ${detail}` : ""}`,
          { code: "AUXILIARY_MODEL_HTTP_ERROR", status: response.status }
        );
      }
      const payload = await response.json();
      return {
        requestId: payload.id ?? `auxiliary-${randomUUID()}`,
        text: (payload.content ?? []).filter((block) => block.type === "text").map((block) => block.text).join("\n"),
        usage: payload.usage,
        provider: "anthropic",
        model: payload.model ?? this.model
      };
    } catch (error) {
      if (controller.signal.aborted) {
        throw new AuxiliaryModelRequestError("Auxiliary model request was cancelled or timed out", {
          code: request.signal?.aborted ? "AUXILIARY_MODEL_CANCELLED" : "AUXILIARY_MODEL_TIMEOUT",
          cause: error
        });
      }
      if (error instanceof AuxiliaryModelRequestError) throw error;
      throw new AuxiliaryModelRequestError("Auxiliary model request failed", { code: "AUXILIARY_MODEL_NETWORK_ERROR", cause: error });
    } finally {
      controller.cleanup();
    }
  }
}
