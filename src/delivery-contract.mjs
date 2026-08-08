import { createHash } from "node:crypto";

function includesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

export function looksLikeExplicitReadOnlyTask(task) {
  const value = String(task ?? "");
  return /(?:只读|仅检查|仅审查|只分析|只解释)/.test(value)
    || /\bread[- ]?only\b/i.test(value)
    || /(?:不要|无需|禁止|请勿|不得|不可)[^。；;\n]{0,48}(?:修改|创建|新增|写入|删除|编辑|变更)[^。；;\n]{0,32}(?:任何|任意|全部)?(?:文件|代码|工作区|项目)/.test(value)
    || /\b(?:do not|don't|without)\b[^.;\n]{0,48}\b(?:modify|create|write|delete|edit|change)\b[^.;\n]{0,32}\b(?:any|the)?\s*(?:files?|code|workspace|project)\b/i.test(value);
}

export function looksLikeWorkspaceMutationTask(task) {
  const value = String(task ?? "");
  if (looksLikeExplicitReadOnlyTask(value)) return false;
  const workspaceNoun = /(?:文件|代码|项目|页面|网页|应用|游戏|功能|组件|脚本|测试)/.test(value)
    || /\b(?:file|code|project|page|app|game|feature|component|script|test)\b/i.test(value)
    || /\.(?:html?|css|jsx?|tsx?|vue|svelte|json|py|java|go|rs)\b/i.test(value);
  const mutationVerb = /(?:创建|制作|做一个|实现|开发|编写|新增|修改|修复|重构|优化|删除|搭建|生成)/.test(value)
    || /\b(?:build|create|implement|develop|write|add|modify|fix|refactor|optimi[sz]e|delete|generate)\b/i.test(value);
  return workspaceNoun && mutationVerb;
}

export function looksLikeUserVisibleWebTask(task) {
  const value = String(task ?? "");
  return /(?:网页|页面|网站|前端|小游戏|游戏|\.html?\b)/i.test(value)
    || /\b(?:web(?:site|page)?|front[- ]?end|game|html)\b/i.test(value);
}

export function looksLikeInteractiveWebTask(task) {
  const value = String(task ?? "");
  return /(?:游戏|小游戏|交互|按钮|表单|登录|注册|搜索|拖拽|点击|键盘|重新开始)/.test(value)
    || /\b(?:game|interactive|button|form|login|sign[- ]?up|search|drag|click|keyboard|restart)\b/i.test(value);
}

function artifactKind(task) {
  if (includesAny(task, [/(?:游戏|小游戏)/, /\bgame\b/i])) return "interactive_web";
  if (includesAny(task, [/(?:网页|页面|网站|前端|\.html?\b)/i, /\b(?:web(?:site|page)?|front[- ]?end|html)\b/i])) return "web";
  if (includesAny(task, [/(?:文件|代码|项目|功能|组件|脚本|测试)/, /\b(?:file|code|project|feature|component|script|test)\b/i])) return "workspace_change";
  return "answer";
}

function expectedMutation(task) {
  return looksLikeWorkspaceMutationTask(task);
}

function entryHint(task) {
  const match = String(task).match(/(?:^|[\s`"'])([\w./\\-]+\.html?)(?=$|[\s`"'，。；])/i);
  return match?.[1]?.replaceAll("\\", "/") ?? null;
}

/** Immutable acceptance contract frozen before the first model request. */
export function createDeliveryContract({ task, capabilities = {}, browserToolsAvailable = false } = {}) {
  const source = String(task ?? "");
  const kind = artifactKind(source);
  const mutationExpected = expectedMutation(source) && kind !== "answer";
  const visual = browserToolsAvailable && ["web", "interactive_web"].includes(kind);
  const contract = {
    schemaVersion: 1,
    contractId: createHash("sha256").update(`${kind}\0${source}`).digest("hex").slice(0, 16),
    artifact: { kind, entryHint: entryHint(source) },
    mutation: { expected: mutationExpected, acceptedTools: ["Write", "Edit", "Delete", "Bash"] },
    tasks: { requireClosedDependencies: true },
    verification: {
      mode: visual ? "browser" : "tool_evidence",
      requirePreview: visual,
      requireNavigation: visual,
      requireInitialInspect: visual,
      requireInitialScreenshot: visual,
      requireInteraction: visual && kind === "interactive_web",
      requirePostInteractionInspect: visual && kind === "interactive_web",
      requirePostInteractionScreenshot: visual && kind === "interactive_web",
      requireHealthyPage: visual,
      providerVision: visual && capabilities?.input?.image === true ? "required" : "not_available"
    }
  };
  return deepFreeze(contract);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function validateDeliveryContract(value) {
  if (!value || value.schemaVersion !== 1 || typeof value.contractId !== "string") throw new TypeError("Invalid DeliveryContract");
  if (!["answer", "workspace_change", "web", "interactive_web"].includes(value.artifact?.kind)) throw new TypeError("Invalid DeliveryContract artifact kind");
  return value;
}
