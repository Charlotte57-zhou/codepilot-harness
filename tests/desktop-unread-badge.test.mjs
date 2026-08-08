import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { createUnreadBadgeSvg, normalizeUnreadCount, unreadBadgeLabel } from "../desktop/unread-badge.mjs";

test("desktop badge count is bounded and uses a compact 9+ label", () => {
  assert.equal(normalizeUnreadCount(-2), 0);
  assert.equal(normalizeUnreadCount(120), 99);
  assert.equal(unreadBadgeLabel(10), "9+");
  assert.match(createUnreadBadgeSvg(3), />3<\/text>/);
});

test("preload exposes only the numeric unread-count intent over IPC", async () => {
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  assert.match(preload, /setUnreadCount\(count\)/);
  assert.match(preload, /ipcRenderer\.send\("codepilot:set-unread-count"/);
  assert.match(main, /ipcMain\.on\("codepilot:set-unread-count"/);
  assert.match(main, /setOverlayIcon/);
});

test("desktop project IPC exposes intents while the main process owns directory selection and runtime switching", async () => {
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const main = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
  const coordinator = await readFile(new URL("../desktop/project-runtime-coordinator.mjs", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(preload, /listProjects\(\)[^]*ipcRenderer\.invoke\("codepilot:projects:list"/);
  assert.match(preload, /listProjectNavigation\(\)[^]*ipcRenderer\.invoke\("codepilot:projects:navigation"/);
  assert.match(preload, /chooseProjectWorkspace\(\)[^]*ipcRenderer\.invoke\("codepilot:projects:choose-workspace"/);
  assert.match(preload, /createProject\(value = \{\}\)[^]*ipcRenderer\.invoke\("codepilot:projects:create"/);
  assert.match(preload, /switchProject\(projectId, navigationIntent = \{\}\)[^]*ipcRenderer\.invoke\("codepilot:projects:switch"/);
  assert.match(preload, /getProjectActions\(projectId\)[^]*codepilot:projects:actions/);
  assert.match(preload, /createProjectWorktree\(projectId, slug\)[^]*codepilot:projects:worktrees:create/);
  assert.match(preload, /removeProjectWorktree\(projectId, targetId\)[^]*codepilot:projects:worktrees:remove/);
  assert.match(main, /dialog\.showOpenDialog\(mainWindow/);
  assert.match(main, /return join\("…", basename\(path\)\)/);
  assert.match(main, /pendingProjectSelections\.set/);
  assert.match(main, /listSessionsForStateRoot\(stateRootFor\(project\)\)/);
  assert.match(main, /CODEPILOT_WORKSPACE_TARGET_ID: target\.id/);
  assert.match(main, /CODEPILOT_PROJECT_MAIN_TARGET_ID: project\.targets\[0\]\.id/);
  assert.match(main, /CODEPILOT_WORKSPACE_ROOT: target\.workspacePath/);
  assert.match(main, /workspaceTargetId: session\.workspaceTargetId/);
  assert.match(server, /mainWorkspaceTargetId[^]*CODEPILOT_PROJECT_MAIN_TARGET_ID/);
  assert.match(server, /projectSession[^]*workspaceTargetId: mainWorkspaceTargetId/);
  assert.match(server, /createSession\(body\.title[^]*\{ workspaceTargetId \}/);
  assert.match(main, /new ProjectRuntimeCoordinator/);
  assert.match(coordinator, /if \(currentState\.running\)/);
  assert.match(coordinator, /this\.router\.swap\(targetRuntime\.port\)/);
  assert.doesNotMatch(main, /switchProjectNow[^]*mainWindow\.loadURL/);
  assert.equal(main.match(/mainWindow\.loadURL/g)?.length, 1, "BrowserWindow loads only the stable shell during its lifecycle");
});

test("sandbox preload executes as CommonJS and exposes only bounded desktop intents", async () => {
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const calls = [];
  let exposed;
  runInNewContext(preload, {
    process: { platform: "win32" },
    require(moduleName) {
      assert.equal(moduleName, "electron");
      return {
        contextBridge: { exposeInMainWorld(name, value) { exposed = { name, value }; } },
        ipcRenderer: {
          send(...args) { calls.push(["send", ...args]); },
          invoke(...args) { calls.push(["invoke", ...args]); return Promise.resolve({}); }
        }
      };
    }
  });
  assert.equal(exposed.name, "codepilotDesktop");
  exposed.value.setUnreadCount(3);
  await exposed.value.chooseProjectWorkspace();
  await exposed.value.createProject({ selectionId: "selection-fixture", name: "Project Fixture" });
  await exposed.value.switchProject("project-fixture");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["send", "codepilot:set-unread-count", 3],
    ["invoke", "codepilot:projects:choose-workspace"],
    ["invoke", "codepilot:projects:create", { selectionId: "selection-fixture", name: "Project Fixture" }],
    ["invoke", "codepilot:projects:switch", "project-fixture", { newTask: false, sessionId: "", workspaceTargetId: "" }]
  ]);
});

test("session navigation owns a constrained scroll region and both attention indicators", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.nav-section\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.session-list\s*\{[^}]*height:\s*100%[^}]*overflow-y:\s*auto[^}]*scrollbar-gutter:\s*stable/s);
  assert.match(css, /\.session-state-indicator\.is-running/);
  assert.match(css, /\.session-state-indicator\.is-complete/);
});

test("session rows use compact typography and the overflow affordance is visually fused", async () => {
  const css = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const titleRule = css.match(/\.session-title\s*\{[^}]*\}/s)?.[0] ?? "";
  assert.match(css, /\.session-row\s*\{[^}]*min-height:\s*34px[^}]*font-size:\s*13px/s);
  assert.match(css, /\.session-row\s*\{[^}]*overflow:\s*hidden[^}]*white-space:\s*nowrap/s);
  assert.match(titleRule, /overflow:\s*hidden/);
  assert.match(titleRule, /text-overflow:\s*clip/);
  assert.match(titleRule, /white-space:\s*nowrap/);
  assert.doesNotMatch(titleRule, /text-overflow:\s*ellipsis/);
  assert.match(css, /\.session-menu-toggle\s*\{[^}]*position:\s*absolute[^}]*top:\s*3px[^}]*background:\s*transparent/s);
  assert.match(css, /\.session-item:hover \.session-menu-toggle[^}]*linear-gradient/s);
  assert.match(css, /\.session-list\s*\{[^}]*width:\s*calc\(100% \+ 8px\)[^}]*margin-right:\s*-8px/s);
  assert.match(css, /\.session-rename-input/);
  assert.match(app, /data-action="rename">重命名/);
  assert.match(server, /request\.method === "PATCH"[^]*renameSession/);
});
