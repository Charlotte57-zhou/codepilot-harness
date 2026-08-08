import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("workspace navigation separates explicit Projects from default-workspace Recent tasks", async () => {
  const [html, app, css] = await Promise.all([
    read("../public/index.html"),
    read("../public/app.js"),
    read("../public/styles.css")
  ]);

  assert.match(html, /project-nav-label[^>]*><span>项目<\/span>/);
  assert.match(html, /id="add-project"/);
  assert.match(html, /id="project-create-dialog"[^]*id="project-create-name"[^]*id="project-workspace-picker"[^]*id="project-create-submit"/);
  assert.match(html, /id="project-edit-dialog"[^]*id="project-edit-name"[^]*id="project-edit-submit"/);
  assert.match(html, /id="worktree-dialog"[^]*id="worktree-list"[^]*id="worktree-slug"[^]*id="worktree-create"/);
  assert.match(html, />新建任务</);
  assert.doesNotMatch(html, />demo-repo</);
  assert.match(app, /api\("\/api\/project"\)/);
  assert.match(app, /window\.codepilotDesktop\.listProjectNavigation/);
  assert.match(app, /candidate\.id !== state\.project\.defaultProjectId/);
  assert.match(app, /recent-group-label[^]*最近/);
  assert.match(app, /createNewSession\(\{ projectId: state\.project\.defaultProjectId \}\)/);
  assert.match(app, /data-project-new/);
  assert.match(app, /data-project-toggle/);
  assert.match(app, /collapsedProjectIds: restoreCollapsedProjects/);
  assert.match(app, /aria-expanded="\$\{String\(!collapsed\)\}"/);
  assert.match(app, /icon\(collapsed \? "folder" : "folder-open"\)/);
  assert.match(app, /persistCollapsedProjects\(\)/);
  assert.doesNotMatch(app, /data-project-switch/);
  assert.match(app, /data-project-action="worktrees"/);
  assert.match(app, /closeProjectMenus\(\{ restoreFocus: true \}\)/);
  assert.match(app, /window\.codepilotDesktop\.createProjectWorktree/);
  assert.match(app, /window\.codepilotDesktop\.removeProjectWorktree/);
  assert.match(app, /window\.codepilotDesktop\?\.switchProject/);
  assert.match(app, /consumeStartupNavigationIntent/);
  assert.match(app, /state\.projectSwitch = \{[^]*startedAt: performance\.now\(\)/);
  assert.match(app, /conversationCache: new Map\(\)/);
  assert.match(app, /showCachedConversation\(navigationIntent\.sessionId\)/);
  assert.match(app, /await loadCurrentProjectRuntime\(receipt\?\.navigationIntent \?\? navigationIntent\)/);
  assert.match(app, /sessionLoadEpoch \+= 1/);
  assert.match(app, /if \(state\.projectSwitch\) return;/);
  assert.match(app, /data-workspace-target-id/);
  assert.match(app, /workspaceTargetId !== state\.project\.currentWorkspaceTargetId/);
  assert.match(html, /id="workspace-target-trigger"[^>]*aria-haspopup="menu"[^]*id="workspace-target-menu"[^>]*aria-label="新任务 Git 工作树"/);
  assert.match(app, /__create_isolated_worktree__[^]*createIsolatedProjectWorktree\(project\.id\)[^]*workspaceTargetId: created\.workspaceTargetId, newTask: true/);
  assert.match(app, /switchProjectFromNavigation\(project\.id, \{ workspaceTargetId, newTask: true \}\)/);
  assert.match(app, /workspaceTargetId === state\.project\.currentWorkspaceTargetId/);
  assert.doesNotMatch(app, /project-switch-indicator/);
  assert.doesNotMatch(app, /session-state-indicator is-switching/);
  assert.doesNotMatch(css, /\.project-switch-indicator/);
  assert.doesNotMatch(css, /\.session-item\.is-switching \.session-row/);
  assert.match(app, /window\.codepilotDesktop\.chooseProjectWorkspace\(\)/);
  assert.match(app, /window\.codepilotDesktop\.createProject\(\{/);
  assert.match(css, /\.session-list/);
  assert.match(css, /\.project-navigation-group/);
  assert.match(css, /\.project-task-list\[hidden\]\s*\{\s*display:\s*none;/);
  assert.match(css, /\.project-navigation-row\s*\{[^}]*position:\s*relative;[^}]*display:\s*flex;/s);
  assert.match(css, /\.project-navigation-toggle\s*\{[^}]*width:\s*100%;[^}]*padding:\s*7px 76px 7px 10px;/s);
  assert.match(css, /\.project-navigation-toggle:hover, \.project-navigation-toggle:focus-visible\s*\{[^}]*background:\s*var\(--panel-raised\);/s);
  assert.match(css, /\.project-navigation-row:hover,[^{}]*\.project-navigation-row:focus-within\s*\{\s*background:\s*var\(--panel-raised\);\s*\}/s);
  assert.doesNotMatch(css, /\.project-navigation-group\.is-current/);
  assert.match(css, /\.project-task-create\s*\{[^}]*position:\s*absolute;[^}]*right:\s*34px;[^}]*transform:\s*translateY\(-50%\);/s);
  assert.match(css, /\.project-menu-toggle\s*\{[^}]*right:\s*2px;/s);
  assert.match(css, /\.project-menu\s*\{[^}]*position:\s*fixed;[^}]*width:\s*218px;/s);
  assert.match(css, /\.worktree-row\s*\{/);
  assert.match(css, /\.composer-workspace-button\s*\{/);
  assert.match(css, /\.workspace-target-menu\s*\{/);
  assert.match(css, /\.project-create-panel/);
});

test("rendering redacts local home identities from model, tool, task, and project-facing text", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /import \{ redactLocalPaths \}/);
  assert.match(app, /function displayHtml/);
  assert.match(app, /const source = redactLocalPaths\(value\)/);
  assert.match(app, /elements\.title\.textContent = displayTaskTitle/);
  assert.match(app, /displayHtml\(`\$\{operation\.command\?\.cwd/);
});
