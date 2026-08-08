function extractJson(text) {
  const match = String(text ?? "").match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export function createProviderVisualReviewer({ modelClient, artifactStore } = {}) {
  if (!modelClient?.capabilities?.input?.image || !artifactStore) return null;
  return async function reviewVisualArtifact({ artifactId, revision, task }) {
    const artifact = await artifactStore.read(artifactId);
    const result = await modelClient.complete({
      messages: [
        { role: "system", content: "你是网页交付视觉验收器。检查截图是否存在重叠遮罩、裁切、不可读文字、异常空白、重复按钮或明显错误状态。只输出 JSON：{\"accepted\":boolean,\"summary\":string,\"issues\":string[]}。" },
        {
          role: "user",
          content: `任务：${String(task ?? "").slice(0, 1_000)}\n这是 workspace revision ${revision} 的浏览器截图。`,
          attachments: [{ origin: "upload", kind: "image", mediaType: artifact.contentType, data: artifact.buffer.toString("base64") }]
        }
      ],
      tools: [],
      maxOutputTokens: 600,
      temperature: 0
    });
    const parsed = extractJson(result.text);
    if (!parsed || typeof parsed.accepted !== "boolean") {
      return { ok: false, content: "", error: { code: "VISUAL_REVIEW_INVALID", message: "Provider visual review did not return valid JSON", details: {} } };
    }
    return {
      ok: true,
      content: parsed.summary ?? "Visual review completed",
      metadata: {
        accepted: parsed.accepted,
        summary: String(parsed.summary ?? ""),
        issues: Array.isArray(parsed.issues) ? parsed.issues.map(String).slice(0, 20) : [],
        revision,
        artifactId,
        provider: modelClient.providerName ?? modelClient.constructor.name
      }
    };
  };
}

export { extractJson };
