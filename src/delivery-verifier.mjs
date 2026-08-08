import { access, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { workspacePreviewUrl } from "./workspace-preview-server.mjs";

async function findHtml(root, hint, changedPaths = []) {
  const candidates = [hint, ...changedPaths.filter((path) => /\.html?$/i.test(path))].filter(Boolean);
  for (const path of candidates) {
    try { await access(join(root, path)); return String(path).replaceAll("\\", "/"); } catch {}
  }
  const found = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if ([".git", ".codepilot", "node_modules"].includes(entry.name)) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) found.push(relative(root, absolute).replaceAll("\\", "/"));
      if (found.length > 20) return;
    }
  }
  await visit(root);
  return found.find((path) => /(?:^|\/)index\.html?$/i.test(path)) ?? found[0] ?? null;
}

/** Deterministic local verifier shared by the SDK engine and eval fixtures. */
export async function verifyDeliveryContract({
  contract,
  ledger,
  workspaceRoot,
  workspacePreviewOrigin,
  browserRuntime,
  changedPaths = [],
  task,
  visualReviewer,
  onEvidence
} = {}) {
  if (contract?.verification?.mode !== "browser") return ledger.evaluateCompletion();
  const path = await findHtml(workspaceRoot, contract.artifact?.entryHint, changedPaths);
  if (!path) return ledger.evaluateCompletion();
  const url = workspacePreviewUrl(workspacePreviewOrigin, path);
  const revision = ledger.snapshot().workspaceRevision;
  const observe = async (name, input, result) => {
    ledger.observe({ name, input }, result);
    await onEvidence?.({ name, input, result, revision });
  };
  await observe("PreviewArtifact", { path }, { ok: true, content: `Preview URL: ${url}`, metadata: { kind: "workspace_preview", path, url } });
  const started = await browserRuntime.startManaged({ headless: true });
  const sessionId = started.sessionId;
  const pageId = started.pages[0].pageId;
  try {
    const navigation = await browserRuntime.navigate({ sessionId, pageId, url });
    await observe("BrowserNavigate", { sessionId, pageId, url }, { ok: true, content: JSON.stringify(navigation), metadata: { automation: navigation } });
    const inspect = await browserRuntime.inspect({ sessionId, pageId });
    await observe("BrowserInspect", { sessionId, pageId }, { ok: true, content: inspect.externalContent, metadata: { automation: inspect } });
    const initialScreenshot = await browserRuntime.screenshot({ sessionId, pageId });
    await observe("BrowserScreenshot", { sessionId, pageId }, { ok: true, content: JSON.stringify(initialScreenshot.artifact), metadata: { automation: initialScreenshot } });
    if (contract.verification.requireInteraction) {
      try {
        const click = await browserRuntime.click({ sessionId, pageId, locator: { css: "button:visible" } });
        await observe("BrowserClick", { sessionId, pageId, locator: { css: "button:visible" } }, { ok: true, content: JSON.stringify(click), metadata: { automation: click } });
        await new Promise((resolve) => setTimeout(resolve, 250));
      } catch (error) {
        await onEvidence?.({ name: "BrowserClick", input: { sessionId, pageId }, result: { ok: false, error: { code: "DELIVERY_INTERACTION_MISSING", message: error.message } }, revision });
        return ledger.evaluateCompletion();
      }
      const postInspect = await browserRuntime.inspect({ sessionId, pageId });
      await observe("BrowserInspect", { sessionId, pageId }, { ok: true, content: postInspect.externalContent, metadata: { automation: postInspect } });
      const postScreenshot = await browserRuntime.screenshot({ sessionId, pageId });
      await observe("BrowserScreenshot", { sessionId, pageId }, { ok: true, content: JSON.stringify(postScreenshot.artifact), metadata: { automation: postScreenshot } });
      if (visualReviewer) {
        const visual = await visualReviewer({ artifactId: postScreenshot.artifact.artifactId, revision, task });
        await observe("ProviderVisualReview", { revision }, visual);
      }
    } else if (visualReviewer) {
      const visual = await visualReviewer({ artifactId: initialScreenshot.artifact.artifactId, revision, task });
      await observe("ProviderVisualReview", { revision }, visual);
    }
    return ledger.evaluateCompletion();
  } finally {
    await browserRuntime.closeSession(sessionId).catch(() => {});
  }
}

export { findHtml };
