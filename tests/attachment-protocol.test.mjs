import test from "node:test";
import assert from "node:assert/strict";
import { attachmentLimits, attachmentPromptText, attachmentTokenEstimate, estimateMessageTokens, normalizeAttachmentRecord, planAttachmentDelivery } from "../src/attachment-protocol.mjs";

test("attachment protocol accepts image and PDF records without treating base64 as text", () => {
  const image = normalizeAttachmentRecord({ id: "image-1", name: "diagram.png", mediaType: "image/png", origin: "upload", data: "aGVsbG8=" });
  const pdf = normalizeAttachmentRecord({ id: "pdf-1", name: "brief.pdf", mediaType: "application/pdf", origin: "upload", data: "cGRm" });
  assert.equal(image.kind, "image");
  assert.equal(pdf.kind, "pdf");
  assert.equal(attachmentTokenEstimate(image), attachmentLimits.imageTokenBudget);
  assert.equal(attachmentTokenEstimate(pdf), attachmentLimits.pdfTokenBudget);
});

test("text attachment prompt projection is bounded while binary attachment accounting stays independent", () => {
  const text = normalizeAttachmentRecord({ id: "text-1", name: "notes.txt", mediaType: "text/plain", origin: "upload", content: "x".repeat(50_000) });
  const image = normalizeAttachmentRecord({ id: "image-1", name: "diagram.png", mediaType: "image/png", origin: "upload", data: "a".repeat(400_000) });
  const prompt = attachmentPromptText([text]);
  const tokens = estimateMessageTokens([{ role: "user", content: "Look at these", attachments: [text, image] }]);
  assert.ok(prompt.length < 33_000);
  assert.ok(tokens < 12_000, "base64 transport bytes must not dominate the context estimate");
});

test("attachment delivery plan separates durable facts from provider-native payloads", () => {
  const messages = [{
    role: "user",
    content: "Inspect these",
    attachments: [
      normalizeAttachmentRecord({ id: "text-1", name: "notes.txt", mediaType: "text/plain", origin: "upload", content: "hello" }),
      normalizeAttachmentRecord({ id: "image-1", name: "diagram.png", mediaType: "image/png", origin: "upload", data: "aGVsbG8=" }),
      normalizeAttachmentRecord({ id: "pdf-1", name: "brief.pdf", mediaType: "application/pdf", origin: "upload", data: "cGRm" })
    ]
  }];
  const plan = planAttachmentDelivery(messages, { input: { text: true, image: true, pdf: false } });
  assert.deepEqual(plan.map(({ kind, disposition, reason }) => ({ kind, disposition, reason })), [
    { kind: "text", disposition: "text_projection", reason: "bounded_text_projection" },
    { kind: "image", disposition: "native", reason: "model_accepts_native_input" },
    { kind: "pdf", disposition: "metadata_only", reason: "model_input_capability_not_declared" }
  ]);
});
