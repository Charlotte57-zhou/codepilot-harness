/**
 * Provider-neutral attachment contract. Attachments are durable session facts,
 * not workspace paths and not text spliced into a user instruction.
 *
 * The raw record stays in JSONL. Provider adapters compile it into their own
 * native content blocks immediately before sampling.
 */
export const attachmentLimits = Object.freeze({
  maxFiles: 4,
  maxTextCharsPerFile: 200_000,
  maxImageBytesPerFile: 2_000_000,
  maxPdfBytesPerFile: 4_000_000,
  maxTotalBytes: 6_000_000,
  maxTextCharsInPrompt: 32_000,
  imageTokenBudget: 1_024,
  pdfTokenBudget: 4_096
});

const imageMediaTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const textMediaType = /^(?:text\/|application\/(?:json|javascript|xml))/i;

export function attachmentKindForMediaType(mediaType = "") {
  if (imageMediaTypes.has(String(mediaType).toLowerCase())) return "image";
  if (String(mediaType).toLowerCase() === "application/pdf") return "pdf";
  return "text";
}

function base64ByteLength(value) {
  const source = String(value ?? "").replace(/\s/g, "");
  if (!source || !/^[A-Za-z0-9+/]*={0,2}$/.test(source) || source.length % 4 !== 0) return 0;
  const padding = source.endsWith("==") ? 2 : source.endsWith("=") ? 1 : 0;
  return Math.floor((source.length * 3) / 4) - padding;
}

function edgeExcerpt(value, limit) {
  const text = String(value ?? "");
  if (text.length <= limit) return text;
  const marker = "\n...[attachment text truncated for context]...\n";
  const available = Math.max(0, limit - marker.length);
  const head = Math.ceil(available / 2);
  return `${text.slice(0, head)}${marker}${text.slice(-(available - head))}`;
}

export function normalizeAttachmentRecord(value = {}) {
  const id = String(value.id ?? "").trim();
  const name = String(value.name ?? "").trim();
  const mediaType = typeof value.mediaType === "string" ? value.mediaType.toLowerCase() : "text/plain";
  const origin = value.origin === "workspace_reference" ? "workspace_reference" : "upload";
  const kind = value.kind ?? attachmentKindForMediaType(mediaType);
  if (!id || !name || !["text", "image", "pdf"].includes(kind)) return null;

  if (kind === "text") {
    if (typeof value.content !== "string") return null;
    return Object.freeze({
      id, name, kind, content: value.content, mediaType: textMediaType.test(mediaType) ? mediaType : "text/plain", origin,
      charCount: value.content.length, byteSize: Buffer.byteLength(value.content, "utf8"),
      estimatedTokens: Math.ceil(value.content.length / 4)
    });
  }

  const data = typeof value.data === "string" ? value.data.replace(/\s/g, "") : "";
  const byteSize = base64ByteLength(data);
  if (!data || !byteSize) return null;
  return Object.freeze({
    id, name, kind, data, mediaType, origin, byteSize, charCount: 0,
    estimatedTokens: kind === "image" ? attachmentLimits.imageTokenBudget : attachmentLimits.pdfTokenBudget
  });
}

export function attachmentMetadata(attachment) {
  return {
    id: attachment.id,
    name: attachment.name,
    kind: attachment.kind ?? attachmentKindForMediaType(attachment.mediaType),
    mediaType: attachment.mediaType,
    origin: attachment.origin,
    charCount: attachment.charCount ?? attachment.content?.length ?? 0,
    byteSize: attachment.byteSize ?? 0,
    estimatedTokens: attachmentTokenEstimate(attachment)
  };
}

export function attachmentTokenEstimate(attachment) {
  if (!attachment) return 0;
  const kind = attachment.kind ?? attachmentKindForMediaType(attachment.mediaType);
  if (kind === "image") return attachmentLimits.imageTokenBudget;
  if (kind === "pdf") return attachmentLimits.pdfTokenBudget;
  return Math.ceil(Math.min(String(attachment.content ?? "").length, attachmentLimits.maxTextCharsInPrompt) / 4);
}

export function estimateMessageTokens(messages = []) {
  return messages.reduce((total, message) => (
    total
    + Math.ceil(String(message?.content ?? "").length / 4)
    + (message?.attachments ?? []).reduce((sum, attachment) => sum + attachmentTokenEstimate(attachment), 0)
  ), 0);
}

export function attachmentPromptText(attachments = []) {
  return attachments
    .filter((attachment) => attachment?.origin === "upload" && (attachment.kind ?? attachmentKindForMediaType(attachment.mediaType)) === "text" && typeof attachment.content === "string")
    .map((attachment) => [
      `<user_attachment id="${attachment.id}" name="${attachment.name}" media_type="${attachment.mediaType}">`,
      edgeExcerpt(attachment.content, attachmentLimits.maxTextCharsInPrompt),
      "</user_attachment>"
    ].join("\n"))
    .join("\n\n");
}

export function attachmentDelivery(attachment, capabilities = {}) {
  const kind = attachment?.kind ?? attachmentKindForMediaType(attachment?.mediaType);
  if (kind === "text") {
    return Object.freeze({
      id: attachment.id,
      name: attachment.name,
      kind,
      disposition: "text_projection",
      reason: "bounded_text_projection"
    });
  }
  const native = capabilities?.input?.[kind] === true;
  return Object.freeze({
    id: attachment.id,
    name: attachment.name,
    kind,
    disposition: native ? "native" : "metadata_only",
    reason: native ? "model_accepts_native_input" : "model_input_capability_not_declared"
  });
}

export function planAttachmentDelivery(messages = [], capabilities = {}) {
  return messages.flatMap((message, messageIndex) => (message?.attachments ?? [])
    .filter((attachment) => attachment?.origin === "upload")
    .map((attachment) => Object.freeze({
      ...attachmentDelivery(attachment, capabilities),
      messageIndex
    })));
}

export function attachmentFallbackText(attachments = [], capabilities = {}) {
  return attachments
    .map((attachment) => ({ attachment, delivery: attachmentDelivery(attachment, capabilities) }))
    .filter(({ delivery }) => delivery.disposition === "metadata_only")
    .map(({ attachment, delivery }) => [
      `<attachment_delivery id="${attachment.id}" name="${attachment.name}" kind="${delivery.kind}" disposition="metadata_only">`,
      "The binary attachment is part of the user message, but its content was not delivered because the current model deployment does not declare native support for this input type.",
      "</attachment_delivery>"
    ].join("\n"))
    .join("\n\n");
}

export function attachmentSummary(attachment) {
  const metadata = attachmentMetadata(attachment);
  if ((attachment.kind ?? attachmentKindForMediaType(attachment.mediaType)) === "text") return { ...metadata, text: edgeExcerpt(attachment.content, attachmentLimits.maxTextCharsInPrompt) };
  return metadata;
}

export function messageForSummary(message) {
  if (!message?.attachments?.length) return message;
  return { ...message, attachments: message.attachments.map(attachmentSummary) };
}

export function mergeMessageTextAndAttachments(message, capabilities = {}) {
  const content = String(message?.content ?? "");
  const attachmentText = attachmentPromptText(message?.attachments);
  const fallbackText = attachmentFallbackText(message?.attachments, capabilities);
  return [content, attachmentText, fallbackText].filter(Boolean).join("\n\n");
}
