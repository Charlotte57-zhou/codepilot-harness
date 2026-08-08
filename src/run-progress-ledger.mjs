import {
  looksLikeInteractiveWebTask,
  looksLikeUserVisibleWebTask,
  looksLikeWorkspaceMutationTask
} from "./delivery-contract.mjs";

const mutationTools = new Set(["CreateDirectory", "Write", "Edit", "Delete", "Bash"]);
const contentMutationTools = new Set(["Write", "Edit", "Delete"]);
const browserObservationTools = new Set(["BrowserInspect", "BrowserScreenshot"]);
const browserInteractionTools = new Set(["BrowserClick", "BrowserType"]);

function metadataValue(result) {
  return result?.metadata?.automation ?? result?.metadata ?? {};
}

function normalizeUrl(value) {
  try { return new URL(String(value)).toString(); } catch { return null; }
}

function pageKey(value) {
  const sessionId = value?.sessionId;
  const pageId = value?.pageId;
  return sessionId && pageId ? `${sessionId}:${pageId}` : null;
}

function browserHealthy(value) {
  if (value?.healthy === false) return false;
  const diagnostics = value?.diagnostics ?? {};
  return (diagnostics.pageErrors?.length ?? 0) === 0
    && (diagnostics.consoleErrors?.length ?? 0) === 0
    && (diagnostics.httpErrors?.length ?? 0) === 0;
}

export class RunIncompleteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RunIncompleteError";
    this.code = "RUN_INCOMPLETE";
    this.terminalReason = "completion_gate_exhausted";
    this.details = details;
  }
}

/**
 * Runtime-owned delivery evidence ledger.
 *
 * A browser receipt is accepted only when it has causal lineage to the latest
 * workspace revision: HTML path -> PreviewArtifact URL -> navigated page ->
 * healthy inspection + screenshot. Interactive work additionally needs a
 * successful action followed by a fresh inspection and screenshot.
 */
export class RunProgressLedger {
  constructor({ task, deliveryContract, maxContinuationTurns = 3, visualVerificationAvailable = false } = {}) {
    this.task = String(task ?? "");
    this.maxContinuationTurns = maxContinuationTurns;
    this.deliveryContract = deliveryContract ?? null;
    this.workspaceMutationExpected = deliveryContract?.mutation?.expected ?? looksLikeWorkspaceMutationTask(task);
    this.visualVerificationExpected = deliveryContract
      ? deliveryContract.verification?.mode === "browser"
      : Boolean(visualVerificationAvailable) && looksLikeUserVisibleWebTask(task);
    this.interactionVerificationExpected = deliveryContract
      ? deliveryContract.verification?.requireInteraction === true
      : this.visualVerificationExpected && looksLikeInteractiveWebTask(task);
    this.providerVisionExpected = deliveryContract?.verification?.providerVision === "required";
    this.mutationAttempts = 0;
    this.successfulMutations = 0;
    this.failedMutations = 0;
    this.workspaceRevision = 0;
    this.latestMutationPath = null;
    this.preview = null;
    this.pages = new Map();
    this.providerVisionReceipt = null;
    this.latestTodos = null;
    this.continuationTurns = 0;
  }

  observe(toolCall, result) {
    const tool = toolCall?.name;
    const value = metadataValue(result);
    if (mutationTools.has(tool)) {
      this.mutationAttempts += 1;
      const bashChanges = tool === "Bash" && Array.isArray(result?.metadata?.fileChanges)
        ? result.metadata.fileChanges
        : [];
      const contentChanged = (result?.ok && contentMutationTools.has(tool)) || bashChanges.length > 0;
      if (contentChanged) {
        if (result?.ok) this.successfulMutations += 1;
        this.workspaceRevision += 1;
        this.latestMutationPath = result.metadata?.path ?? bashChanges.at(-1)?.path ?? toolCall?.input?.path ?? null;
        this.preview = null;
        this.pages.clear();
      }
      if (!result?.ok) this.failedMutations += 1;
    }

    if (tool === "ProviderVisualReview" && result?.ok && value.accepted === true && value.revision === this.workspaceRevision) {
      this.providerVisionReceipt = { revision: this.workspaceRevision, summary: value.summary ?? "accepted" };
    }

    if (tool === "PreviewArtifact" && result?.ok) {
      const path = result.metadata?.path ?? value.path;
      const url = normalizeUrl(result.metadata?.url ?? value.url);
      if (path && url) this.preview = { path, url, revision: this.workspaceRevision };
    }

    if (tool === "BrowserNavigate" && result?.ok && this.preview?.revision === this.workspaceRevision) {
      const key = pageKey(value);
      if (key) this.pages.delete(key);
      const requestedUrl = normalizeUrl(toolCall?.input?.url);
      const actualUrl = normalizeUrl(value.url);
      const status = Number(value.status);
      const statusOk = value.status == null || (Number.isFinite(status) && status >= 200 && status < 400);
      if (key && statusOk && requestedUrl === this.preview.url && actualUrl === this.preview.url) {
        this.pages.set(key, {
          revision: this.workspaceRevision,
          url: actualUrl,
          initialInspect: false,
          initialScreenshot: false,
          interactionCount: 0,
          postInteractionInspect: false,
          postInteractionScreenshot: false,
          unhealthyObservations: 0
        });
      }
    }

    const key = pageKey(value) ?? pageKey(toolCall?.input);
    const page = key ? this.pages.get(key) : null;
    if (page && page.revision === this.workspaceRevision) {
      if (browserInteractionTools.has(tool) && result?.ok) {
        page.interactionCount += 1;
        this.providerVisionReceipt = null;
        page.postInteractionInspect = false;
        page.postInteractionScreenshot = false;
      }
      if (browserObservationTools.has(tool) && result?.ok && normalizeUrl(value.url) === page.url) {
        if (!browserHealthy(value)) {
          page.unhealthyObservations += 1;
        } else if (tool === "BrowserInspect") {
          if (page.interactionCount > 0) page.postInteractionInspect = true;
          else page.initialInspect = true;
        } else if (tool === "BrowserScreenshot") {
          if (page.interactionCount > 0) page.postInteractionScreenshot = true;
          else page.initialScreenshot = true;
        }
      }
    }

    if (tool === "UpdateTodoList" && result?.ok && result.metadata?.kind === "todo_list") {
      this.latestTodos = result.metadata.todos.map((todo) => ({ ...todo }));
    }
  }

  #verifiedPage() {
    return [...this.pages.values()].find((page) => page.revision === this.workspaceRevision
      && page.initialInspect && page.initialScreenshot
      && page.unhealthyObservations === 0
      && (!this.interactionVerificationExpected
        || (page.interactionCount > 0 && page.postInteractionInspect && page.postInteractionScreenshot)));
  }

  snapshot() {
    const completedTodos = this.latestTodos?.filter((todo) => todo.status === "completed").length ?? 0;
    const verified = this.#verifiedPage();
    return Object.freeze({
      workspaceMutationExpected: this.workspaceMutationExpected,
      mutationAttempts: this.mutationAttempts,
      successfulMutations: this.successfulMutations,
      failedMutations: this.failedMutations,
      workspaceRevision: this.workspaceRevision,
      latestMutationPath: this.latestMutationPath,
      visualVerificationExpected: this.visualVerificationExpected,
      interactionVerificationExpected: this.interactionVerificationExpected,
      providerVisionExpected: this.providerVisionExpected,
      providerVisionAccepted: this.providerVisionReceipt?.revision === this.workspaceRevision,
      previewPath: this.preview?.path ?? null,
      previewRevision: this.preview?.revision ?? null,
      browserPageCount: this.pages.size,
      visualVerificationAfterLatestMutation: Boolean(verified),
      verifiedInteractionCount: verified?.interactionCount ?? 0,
      todoTotal: this.latestTodos?.length ?? 0,
      todoCompleted: completedTodos,
      todoOpen: (this.latestTodos?.length ?? 0) - completedTodos,
      continuationTurns: this.continuationTurns,
      maxContinuationTurns: this.maxContinuationTurns
    });
  }

  evaluateCompletion() {
    const reasons = [];
    const openTodos = this.latestTodos?.filter((todo) => todo.status !== "completed") ?? [];
    if (openTodos.length) {
      reasons.push(`结构化任务清单仍有 ${openTodos.length} 项未完成：${openTodos.slice(0, 3).map((todo) => todo.content).join("；")}`);
    }
    if (this.workspaceMutationExpected && this.successfulMutations === 0) {
      reasons.push(this.mutationAttempts > 0
        ? "工作区内容修改尚未成功落盘；仅创建目录不构成交付证据"
        : "任务要求修改工作区，但本轮还没有产生成功的 Write/Edit/Delete 证据");
    }
    if (this.visualVerificationExpected && this.successfulMutations > 0 && !this.#verifiedPage()) {
      if (!this.preview || this.preview.revision !== this.workspaceRevision) {
        reasons.push("最后一次内容修改后还没有为当前 HTML 产物生成 PreviewArtifact 回执");
      } else if (this.pages.size === 0) {
        reasons.push("当前 PreviewArtifact URL 还没有在同一浏览器页面中完成 BrowserNavigate");
      } else {
        const pages = [...this.pages.values()];
        if (pages.some((page) => page.unhealthyObservations > 0)) reasons.push("浏览器检查发现 pageerror、console.error 或资源 HTTP 错误，需要修复后重新验证");
        if (!pages.some((page) => page.initialInspect && page.initialScreenshot)) reasons.push("首屏还缺少同一页面的 BrowserInspect 与 BrowserScreenshot 双重回执");
        if (this.interactionVerificationExpected && !pages.some((page) => page.interactionCount > 0)) reasons.push("交互产物还没有执行关键 BrowserClick 或 BrowserType");
        if (this.interactionVerificationExpected && pages.some((page) => page.interactionCount > 0)
          && !pages.some((page) => page.postInteractionInspect && page.postInteractionScreenshot)) {
          reasons.push("关键交互后还缺少新的 BrowserInspect 与 BrowserScreenshot 回执");
        }
      }
    }
    if (this.providerVisionExpected && this.successfulMutations > 0
      && this.providerVisionReceipt?.revision !== this.workspaceRevision) {
      reasons.push("当前 revision 还缺少支持图像输入的 Provider 视觉审查回执");
    }
    if (!reasons.length) return { accepted: true, reasons: [], snapshot: this.snapshot() };

    this.continuationTurns += 1;
    const exhausted = this.continuationTurns > this.maxContinuationTurns;
    return {
      accepted: false,
      exhausted,
      reasons,
      snapshot: this.snapshot(),
      feedback: `运行时完成门禁尚未通过。请继续执行任务，不要只给总结。\n${reasons.map((reason) => `- ${reason}`).join("\n")}\n网页产物必须建立可追溯回执链：最后一次修改 -> PreviewArtifact -> BrowserNavigate（精确 URL）-> BrowserInspect + BrowserScreenshot。游戏或交互页面还要执行一个关键 BrowserClick/BrowserType，并在交互后再次 Inspect + Screenshot。浏览器诊断存在 pageerror、console.error 或资源 HTTP 错误时先修复；后续修改会使旧回执失效。`
    };
  }
}

export { looksLikeInteractiveWebTask, looksLikeUserVisibleWebTask, looksLikeWorkspaceMutationTask };
