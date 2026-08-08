import { activityCopy } from "./activity-copy-catalog.js";
import { BOOKKEEPING_ACTIVITY_KEYS } from "./activity-taxonomy.js";

const terminalStatuses = new Set(["completed", "partially_failed", "failed", "declined", "cancelled", "not_run"]);

function join(parts, locale) {
  if (parts.length < 2) return parts[0] ?? "";
  const conjunction = locale === "en" ? " and " : "并";
  const separator = locale === "en" ? ", " : "、";
  return `${parts.slice(0, -1).join(separator)}${conjunction}${parts.at(-1)}`;
}

function groupKey(operation) {
  return operation.family === "exploration" ? "exploration" : operation.family;
}

function baseName(value) {
  return String(value ?? "").split(/[\\/]/).filter(Boolean).at(-1) ?? "";
}

function clause(group, live, locale) {
  const count = group.operations.length;
  const status = live ? "running" : "completed";
  if (locale === "en") {
    if (group.key === "exploration") return live ? "Exploring code" : `Explored ${count} item${count === 1 ? "" : "s"}`;
    if (group.key === "command") return live ? "Running commands" : `Ran ${count} command${count === 1 ? "" : "s"}`;
    if (group.key === "file") return live ? "Editing files" : `Edited ${count} file${count === 1 ? "" : "s"}`;
  } else {
    if (group.key === "exploration") return live ? "检查代码" : count === 1 ? "检查了代码" : `检查了 ${count} 项代码`;
    if (group.key === "command") return live ? (count === 1 ? "运行命令" : `运行 ${count} 个命令`) : (count === 1 ? "运行了命令" : `运行了 ${count} 个命令`);
    if (group.key === "file") {
      const target = count === 1 ? baseName(group.operations[0].subject?.primary) : "";
      return live
        ? (count === 1 ? `编辑 ${target || "文件"}` : `编辑 ${count} 个文件`)
        : (count === 1 ? `编辑了 ${target || "文件"}` : `编辑了 ${count} 个文件`);
    }
    if (group.key === "browser" || group.key === "computer") return live ? "检查界面" : "检查了界面";
    if (group.key === "mcp") return live ? "调用 MCP 工具" : "调用了 MCP 工具";
    if (group.key === "subagent") return live ? "委派子任务" : "委派了子任务";
  }
  return activityCopy(group.operations[0].semanticKey, status, locale).replace(locale === "en" ? /^(Running|Ran) / : /^(正在|已)/, "");
}

export function summarizeActivityOperations(operations = [], { locale = "zh-CN", maxClauses = 3 } = {}) {
  const visible = operations.filter((operation) => !BOOKKEEPING_ACTIVITY_KEYS.has(operation.semanticKey));
  if (!visible.length) return { label: locale === "en" ? "Running tools" : "执行工具", count: 0, live: false };
  const live = visible.some((operation) => !terminalStatuses.has(operation.status));
  const groups = [];
  for (const operation of visible) {
    const key = groupKey(operation);
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) groups.push(group = { key, operations: [] });
    group.operations.push(operation);
  }
  const primary = groups.slice(0, maxClauses).map((group) => clause(group, live, locale));
  if (groups.length > maxClauses) {
    const extra = groups.slice(maxClauses).reduce((sum, group) => sum + group.operations.length, 0);
    primary.push(locale === "en" ? `${extra} other operation${extra === 1 ? "" : "s"}` : `${extra} 项其他操作`);
  }
  const prefix = live ? (locale === "en" ? "" : "正在") : "";
  const failed = visible.filter((operation) => operation.status === "failed").length;
  const cancelled = visible.filter((operation) => operation.status === "cancelled").length;
  const declined = visible.filter((operation) => operation.status === "declined").length;
  const suffix = failed
    ? (locale === "en" ? `; ${failed} failed` : `，其中 ${failed} 项失败`)
    : cancelled ? (locale === "en" ? `; ${cancelled} cancelled` : `，其中 ${cancelled} 项已取消`)
      : declined ? (locale === "en" ? `; ${declined} declined` : `，其中 ${declined} 项未获批准`) : "";
  return { label: `${prefix}${join(primary, locale)}${suffix}`, count: visible.length, live, failed, cancelled, declined };
}
