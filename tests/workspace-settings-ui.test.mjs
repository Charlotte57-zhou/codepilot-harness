import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css, preload] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8"),
  readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8")
]);

test("sidebar settings owns appearance while runtime model config keeps its dedicated layer", () => {
  assert.match(html, /id="settings-layer"[\s\S]*data-settings-panel="appearance"/);
  assert.match(html, /data-settings-view="activity"/);
  assert.match(html, /data-settings-view="archives"/);
  assert.match(html, /id="runtime-settings-layer"[\s\S]*id="model-form"/);
  assert.match(app, /#sidebar-settings"\)\.addEventListener\("click", \(\) => openWorkspaceSettings/);
  assert.match(app, /#model-settings"\)\.addEventListener\("click", \(\) => openModelSettings/);
});

test("theme selection is bounded, persisted locally, and expressed through design tokens", () => {
  assert.match(app, /theme === "dark" \? "dark" : "light"/);
  assert.match(app, /localStorage\.setItem\(themeStorageKey, selected\)/);
  assert.match(css, /:root\[data-theme="dark"\]\s*\{[\s\S]*--canvas:[\s\S]*--sidebar:[\s\S]*--ink:/);
  assert.match(css, /\.theme-options input:checked \+ \.theme-preview/);
});

test("archived sessions are managed outside the Project and Recent navigation", () => {
  const navigationBody = app.slice(app.indexOf("function renderProjectNavigation"), app.indexOf("async function loadProjectContext"));
  assert.doesNotMatch(navigationBody, /session-subgroup-label|recentArchived|archivedRows/);
  assert.match(app, /function renderArchivedSessions\(\)/);
  assert.match(app, /title: "彻底删除这个会话？"/);
  assert.match(preload, /restoreArchivedSession\(projectId, sessionId\)/);
  assert.match(preload, /deleteArchivedSession\(projectId, sessionId\)/);
});

test("Project actions share their selected row surface with equal navigation insets", () => {
  assert.doesNotMatch(app, /projectRowSelectionId/);
  assert.doesNotMatch(css, /project-navigation-group\.is-current/);
  assert.match(css, /\.project-navigation-row:hover,[\s\S]*\.project-navigation-row:focus-within \{ background: var\(--panel-raised\); \}/);
  assert.match(css, /\.project-navigation-toggle\s*\{[\s\S]*padding: 8px 76px 8px 12px;/);
  assert.match(css, /\.session-row\s*\{[\s\S]*min-height: 40px;[\s\S]*padding-inline: 12px;/);
  assert.match(css, /\.project-task-create,[\s\S]*\.project-menu-toggle,[\s\S]*background: transparent;/);
});

test("activity view consumes the server aggregate instead of scanning JSONL in the renderer", () => {
  assert.match(app, /const activity = await api\("\/api\/activity"\)/);
  assert.match(app, /activity\.totalTokens/);
  assert.doesNotMatch(app, /\.codepilot[\\/]sessions|readFile\(/);
});
