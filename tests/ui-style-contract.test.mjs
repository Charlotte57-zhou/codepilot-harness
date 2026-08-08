import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1] ?? "";
}

test("primary navigation uses one hover treatment and one vertical rhythm", () => {
  const idle = rule(".new-session, .skills-nav-button");
  const hover = rule(".new-session:hover, .skills-nav-button:hover, .mcp-nav-button:hover");
  const active = rule(".new-session:active");

  assert.match(idle, /border:\s*1px solid transparent/);
  assert.match(idle, /background:\s*transparent/);
  assert.match(hover, /border-color:\s*var\(--line\)/);
  assert.match(hover, /background:\s*var\(--panel\)/);
  assert.match(css, /\.new-session\s*\{\s*margin-bottom:\s*2px/);
  assert.match(css, /\.skills-nav-button\s*\{\s*margin-bottom:\s*2px/);
  assert.match(active, /border-color:\s*var\(--accent\)/);
  assert.match(active, /background:\s*var\(--accent-soft\)/);
});

test("keyboard focus remains independently visible", () => {
  assert.match(rule(":focus-visible"), /outline:\s*2px solid var\(--accent-hover\)/);
});

test("todo progress is a compact collapsed-first control with diff metadata", () => {
  assert.match(app, /if \(!todo \|\| !state\.running\)/);
  assert.doesNotMatch(app, /任务清单已停止|任务清单未完成/);
  assert.match(rule(".todo-list-popover"), /left:\s*50%/);
  assert.match(rule(".todo-list-popover"), /width:\s*max-content/);
  assert.match(rule(".todo-list-popover"), /transform:\s*translateX\(-50%\)/);
  assert.match(rule(".todo-list-popover:has(details[open])"), /width:\s*min\(660px/);
  assert.match(rule(".todo-list-popover"), /border-radius:\s*10px/);
  assert.match(rule(".todo-list-popover"), /box-shadow:/);
  assert.match(rule(".todo-list-popover details > summary"), /grid-template-columns:\s*22px minmax\(0, 1fr\) auto 16px/);
  assert.match(rule(".todo-list-popover details > summary"), /min-height:\s*62px/);
  assert.match(rule(".todo-list-popover li"), /grid-template-columns:\s*24px 16px minmax\(0, 1fr\) auto/);
  assert.match(rule(".todo-list-popover li"), /min-height:\s*46px/);
  assert.match(css, /\.todo-item-index/);
  assert.match(css, /\.todo-item-state/);
  assert.match(css, /\.todo-diff-summary/);
  assert.match(css, /\.todo-file-summary/);
  assert.match(css, /\.todo-diff-summary \.diff-add, \.todo-file-summary \.diff-add\s*\{[^}]*var\(--success\)/);
  assert.match(css, /\.todo-diff-summary \.diff-delete, \.todo-file-summary \.diff-delete\s*\{[^}]*var\(--danger\)/);
  assert.match(app, /class="diff-add">\+\$\{changeSet\.additions\}/);
  assert.match(app, /class="diff-delete">-\$\{changeSet\.deletions\}/);
});

test("modern dark decision and audit surfaces preserve semantic ownership", () => {
  assert.match(app, /permission-request-dialog/);
  assert.match(app, /PERMISSION REQUEST/);
  assert.match(app, /data-approval="deny_task"/);
  assert.match(app, /data-approval="allow_once"/);
  assert.match(rule(".permission-request-dialog"), /width:\s*min\(660px/);

  assert.match(html, /settings-group/);
  assert.match(html, /settings-snapshot-badge/);
  assert.match(html, /配置由本地 Server 持有/);
  assert.match(css, /\.settings-dialog\s*\{[^}]*width:\s*min\(760px/);
  assert.match(css, /\.settings-body\s*\{[^}]*overflow-y:\s*auto/);

  assert.match(app, /event-log-columns/);
  assert.match(app, /event-log-status-dot/);
  assert.match(app, /JSONL · APPEND ONLY/);
  assert.match(rule(".event-log-dialog"), /grid-template-rows:\s*116px 82px 48px minmax\(0, 1fr\) 70px/);
  assert.match(rule(".event-log-dialog"), /width:\s*min\(1768px/);
  assert.match(rule(".event-log-dialog"), /height:\s*min\(1116px/);
  assert.match(rule(".event-log-list"), /overflow:\s*auto/);
});

test("execution projection is body-readable while activity chrome stays quiet and collapsed-first", () => {
  assert.match(rule(".trace-analysis-body"), /color:\s*var\(--ink\)/);
  assert.match(rule(".trace-analysis-body"), /font:\s*14px\/1\.65 var\(--sans\)/);
  assert.match(rule(".trace-analysis.is-streaming .trace-analysis-body"), /color:\s*var\(--ink\)/);
  assert.match(rule(".trace-analysis-head .trace-activity-icon"), /color:\s*var\(--dim\)/);
  assert.match(rule(".trace-batch-label"), /color:\s*var\(--muted\)/);
  assert.match(rule(".trace-batch-label"), /font-weight:\s*520/);
  assert.match(app, /const open = state\.openToolBatches\.has\(id\)/);
  assert.doesNotMatch(app, /const open = completed < executions\.length \|\| state\.openToolBatches/);
  assert.match(app, /projectRunTaskText\(data\.summary, data\.runId\)/);
});

test("runtime views share semantic projections instead of hard-coded failure copy", () => {
  assert.match(app, /from "\.\/event-presentation\.js"/);
  assert.doesNotMatch(app, /source\.slice\(0,\s*420\)/, "expanded execution explanations must remain complete");
  assert.doesNotMatch(app, /<strong>模型请求失败<\/strong>/);
  assert.match(app, /eventLabel\(event\)/);
  assert.match(app, /event\.type === "tool_requested"/);
  assert.match(css, /\.activity-row\.is-error \.activity-dot/);
  assert.match(css, /\.activity-row\.is-cancelled \.activity-dot/);
});

test("file review is a docked split view and runnable artifacts live in final prose", () => {
  assert.match(css, /data-inspector-view="review"[^}]+minmax\(460px, 0\.85fr\)[^}]+minmax\(620px, 1\.15fr\)/);
  assert.match(rule(".diff-view"), /max-height:\s*calc\(100dvh - 144px\)/);
  assert.match(rule('.workspace[data-inspector-view="review"] .inspector'), /grid-template-rows:\s*auto minmax\(0, 1fr\)/);
  assert.match(app, /class="artifact-output"/);
  assert.match(app, /previewArtifactForFile/);
  assert.doesNotMatch(app, /data-artifact-path|openWorkspaceArtifact|打开网页/);
  assert.doesNotMatch(css, /review-file-command/);
});
