import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell, utilityProcess } from "electron";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { APP_BRAND } from "./brand.mjs";
import { applicationModelStateRoot, desktopUserDataPath, ensureDemoWorkspace, projectStateRoot, runtimeAppRoot } from "./app-paths.mjs";
import { ProjectRegistry } from "./project-registry.mjs";
import { ProjectRuntimeCoordinator } from "./project-runtime-coordinator.mjs";
import { GitWorkspaceService } from "./git-workspace-service.mjs";
import { GitHubCliBridge } from "./github-cli-bridge.mjs";
import { createDesktopRuntimeRouter, isWorkspacePreviewUrl } from "./runtime-router.mjs";
import { createUnreadBadgeSvg, normalizeUnreadCount } from "./unread-badge.mjs";
import { publicRuntimeStartupDetail, runtimeProcessExited } from "./runtime-process.mjs";
import { archiveSessionsForStateRoot, deleteSessionForStateRoot, listSessionsForStateRoot, restoreSessionForStateRoot } from "../src/session-store.mjs";

const desktopDir = dirname(fileURLToPath(import.meta.url));
const appRoot = dirname(desktopDir);
const isDevelopment = process.argv.includes("--devtools");

app.setName(APP_BRAND.name);
app.setAppUserModelId(APP_BRAND.appUserModelId);
app.setPath("userData", desktopUserDataPath({
  appDataPath: app.getPath("appData"),
  currentUserDataPath: app.getPath("userData"),
  isPackaged: app.isPackaged
}));
app.commandLine.appendSwitch("force-renderer-accessibility");

let mainWindow;
let runtimeRouter;
let runtimeCoordinator;
let quitting = false;
let projectRegistry;
let currentProject;
let currentTarget;
const pendingProjectSelections = new Map();
const projectSelectionTtlMs = 5 * 60_000;
const gitWorkspaceService = new GitWorkspaceService();
const githubCliBridge = new GitHubCliBridge();

function samePath(left, right) {
  const normalize = (value) => process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
  return normalize(left) === normalize(right);
}

function displayWorkspacePath(path) {
  const fromHome = relative(homedir(), path);
  if (fromHome === "") return "~";
  if (fromHome && !fromHome.startsWith("..") && !isAbsolute(fromHome)) return join("~", fromHome);
  return join("…", basename(path));
}

function publicTarget(target) {
  return Object.freeze({
    id: target.id,
    kind: target.kind,
    branch: target.branch,
    displayPath: displayWorkspacePath(target.workspacePath)
  });
}

function publicProject(project) {
  return Object.freeze({
    id: project.id,
    name: project.name,
    pinned: project.pinned,
    displayPath: displayWorkspacePath(project.workspacePath),
    targets: project.targets.map(publicTarget),
    isDefault: project.id === projectRegistry.snapshot().defaultProjectId
  });
}

function publicProjects() {
  const snapshot = projectRegistry.snapshot();
  return {
    defaultProjectId: snapshot.defaultProjectId,
    currentProjectId: snapshot.selectedProjectId,
    currentWorkspaceTargetId: snapshot.selectedTargetId,
    projects: snapshot.projects.map(publicProject)
  };
}

function publicTask(session, project) {
  return Object.freeze({
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
    latestRunState: session.latestRunState,
    latestTerminalEventId: session.latestTerminalEventId,
    workspaceTargetId: session.workspaceTargetId
  });
}

async function publicProjectNavigation() {
  const snapshot = projectRegistry.snapshot();
  const projects = await Promise.all(snapshot.projects.map(async (project) => {
    const [active, archived] = await Promise.all([
      listSessionsForStateRoot(stateRootFor(project)),
      listSessionsForStateRoot(stateRootFor(project), true)
    ]);
    return {
      ...publicProject(project),
      tasks: active.slice(0, 30).map((session) => publicTask(session, project)),
      archivedTasks: archived.map((session) => publicTask(session, project))
    };
  }));
  return { defaultProjectId: snapshot.defaultProjectId, currentProjectId: snapshot.selectedProjectId, currentWorkspaceTargetId: snapshot.selectedTargetId, projects };
}

async function projectActionState(projectId) {
  const project = projectRegistry.get(projectId);
  if (!project) throw new Error("Project not found");
  const inspected = await gitWorkspaceService.inspect(project.workspacePath);
  const repositoryRootSelected = inspected.available && samePath(inspected.repositoryPath, project.workspacePath);
  const sessions = await Promise.all([
    listSessionsForStateRoot(stateRootFor(project)),
    listSessionsForStateRoot(stateRootFor(project), true)
  ]).then((items) => items.flat());
  return Object.freeze({
    project: publicProject(project),
    currentWorkspaceTargetId: project.id === currentProject.id ? currentTarget.id : project.targets[0].id,
    git: inspected.available && repositoryRootSelected
      ? { available: true, branch: inspected.branch, dirty: inspected.dirty }
      : { available: false, reason: inspected.available ? "请选择 Git 仓库根目录作为项目工作区。" : "此项目不是 Git 仓库。" },
    targets: project.targets.map((target) => ({
      ...publicTarget(target),
      taskCount: sessions.filter((session) => session.workspaceTargetId === target.id).length
    }))
  });
}

async function assertProjectMutationAvailable() {
  const runtime = await runtimeProjectState(runtimeCoordinator.currentRuntime);
  if (runtime.running) throw new Error("当前任务正在运行，任务结束后再管理项目或工作树。");
}

function githubWorkspaceFor(project) {
  if (project.id === currentProject.id) return currentTarget.workspacePath;
  return project.targets[0].workspacePath;
}

function cleanExpiredProjectSelections() {
  const now = Date.now();
  for (const [selectionId, selection] of pendingProjectSelections) {
    if (now - selection.createdAt > projectSelectionTtlMs) pendingProjectSelections.delete(selectionId);
  }
}

function updateUnreadBadge(value) {
  const count = normalizeUnreadCount(value);
  if (process.platform === "win32") {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!count) {
      mainWindow.setOverlayIcon(null, "");
      return;
    }
    const svg = createUnreadBadgeSvg(count);
    const overlay = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`);
    mainWindow.setOverlayIcon(overlay, `${count} 个已完成任务`);
    return;
  }
  app.setBadgeCount(count);
}

ipcMain.on("codepilot:set-unread-count", (_event, count) => updateUnreadBadge(count));

function getFreePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function stateRootFor(project) {
  return projectStateRoot(app.getPath("userData"), project.id);
}

function modelStateRoot() {
  return applicationModelStateRoot(app.getPath("userData"));
}

function startHarness(port, artifactPreviewPort, project, target, controlToken) {
  return new Promise((resolve, reject) => {
    const runtimeRoot = runtimeAppRoot({ appRoot, resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    const env = {
      ...process.env,
      PORT: String(port),
      CODEPILOT_PREVIEW_PORT: String(artifactPreviewPort),
      CODEPILOT_DESKTOP: "1",
      CODEPILOT_PROJECT_ID: project.id,
      CODEPILOT_PROJECT_NAME: project.name,
      CODEPILOT_PROJECT_MAIN_TARGET_ID: project.targets[0].id,
      CODEPILOT_WORKSPACE_TARGET_ID: target.id,
      CODEPILOT_WORKSPACE_ROOT: target.workspacePath,
      CODEPILOT_STATE_ROOT: stateRootFor(project),
      CODEPILOT_MODEL_STATE_ROOT: modelStateRoot(),
      CODEPILOT_RUNTIME_CONTROL_TOKEN: controlToken
    };
    const child = app.isPackaged
      ? utilityProcess.fork(join(runtimeRoot, "server.mjs"), [], {
        cwd: runtimeRoot,
        env,
        stdio: "pipe",
        serviceName: "CodePilot Runtime"
      })
      : spawn(process.execPath, [join(runtimeRoot, "server.mjs")], {
      cwd: runtimeRoot,
      env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    let stderr = "";
    let settled = false;
    const finish = (callback, value, { terminate = false } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(startupTimer);
      if (terminate && !runtimeProcessExited(child)) child.kill();
      callback(value);
    };
    const startupTimer = setTimeout(() => {
      finish(reject, new Error("CodePilot local runtime did not start within 15 seconds."), { terminate: true });
    }, 15_000);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (chunk.includes(`http://localhost:${port}`)) finish(resolve, child);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once?.("error", (error) => finish(reject, error, { terminate: true }));
    child.once("exit", (code) => finish(reject, new Error(stderr || `CodePilot local runtime exited with code ${code}.`)));
  });
}

function stopRuntimeProcess(child) {
  if (!child || child.killed === true || runtimeProcessExited(child)) return Promise.resolve();
  return new Promise((resolveStop) => {
    const timeout = setTimeout(() => {
      if (!runtimeProcessExited(child)) child.kill();
      resolveStop();
    }, 8_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveStop();
    });
    child.kill();
  });
}

async function startProjectRuntime(project, target) {
  const port = await getFreePort();
  const controlToken = randomUUID();
  const process = await startHarness(port, 0, project, target, controlToken);
  return { port, process, previewOrigin: null, controlToken };
}

function stopProjectRuntime(runtime) {
  return stopRuntimeProcess(runtime?.process);
}

async function runtimeProjectState(runtime, { refreshModelConfig = false } = {}) {
  const origin = `http://127.0.0.1:${runtime.port}`;
  if (refreshModelConfig) {
    const refreshResponse = await fetch(`${origin}/api/internal/reload-model-config`, {
      method: "POST",
      headers: { "x-codepilot-runtime-control": runtime.controlToken }
    });
    if (!refreshResponse.ok) throw new Error("Unable to refresh the Project runtime model configuration");
  }
  const [projectResponse, configResponse] = await Promise.all([
    fetch(`${origin}/api/project`, { headers: { accept: "application/json" } }),
    fetch(`${origin}/api/config`, { headers: { accept: "application/json" } })
  ]);
  if (!projectResponse.ok || !configResponse.ok) throw new Error("Unable to verify the Project runtime");
  const [project, config] = await Promise.all([projectResponse.json(), configResponse.json()]);
  return { ...project, previewOrigin: config.previewOrigin };
}

async function resolveProjectWorkspaceTarget(project, intent) {
  let targetId = intent.workspaceTargetId;
  if (intent.sessionId) {
    const taskLists = await Promise.all([
      listSessionsForStateRoot(stateRootFor(project)),
      listSessionsForStateRoot(stateRootFor(project), true)
    ]);
    const task = taskLists.flat().find((candidate) => candidate.id === intent.sessionId);
    if (!task) throw new Error("Task not found in Project");
    targetId = task.workspaceTargetId;
  }
  return projectRegistry.target(project.id, targetId ?? project.targets[0].id);
}

async function switchProject(projectId, navigationIntent = {}) {
  const receipt = await runtimeCoordinator.switchProject(projectId, navigationIntent);
  currentProject = runtimeCoordinator.currentProject;
  currentTarget = runtimeCoordinator.currentTarget;
  if (receipt.changed) updateUnreadBadge(0);
  return { ...publicProjects(), navigationIntent: receipt.navigationIntent };
}

ipcMain.handle("codepilot:projects:list", () => publicProjects());
ipcMain.handle("codepilot:projects:navigation", () => publicProjectNavigation());
ipcMain.handle("codepilot:projects:switch", (_event, projectId, navigationIntent) => switchProject(String(projectId ?? ""), navigationIntent));
ipcMain.handle("codepilot:projects:actions", (_event, projectId) => projectActionState(String(projectId ?? "")));
ipcMain.handle("codepilot:projects:pin", async (_event, projectId, pinned) => {
  await projectRegistry.setPinned(String(projectId ?? ""), pinned === true);
  return publicProjects();
});
ipcMain.handle("codepilot:projects:open", async (_event, projectId, targetId) => {
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  const target = projectRegistry.target(project.id, String(targetId ?? "")) ?? project.targets[0];
  const error = await shell.openPath(target.workspacePath);
  if (error) throw new Error("资源管理器未能打开这个工作区。");
  return { opened: true };
});
ipcMain.handle("codepilot:projects:rename", async (_event, projectId, name) => {
  await projectRegistry.rename(String(projectId ?? ""), String(name ?? ""));
  return publicProjects();
});
ipcMain.handle("codepilot:projects:archive-chats", async (_event, projectId) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  const archivedCount = await archiveSessionsForStateRoot(stateRootFor(project));
  return { archivedCount, navigation: await publicProjectNavigation() };
});
ipcMain.handle("codepilot:projects:archived:restore", async (_event, projectId, sessionId) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  await restoreSessionForStateRoot(stateRootFor(project), String(sessionId ?? ""));
  return publicProjectNavigation();
});
ipcMain.handle("codepilot:projects:archived:delete", async (_event, projectId, sessionId) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  await deleteSessionForStateRoot(stateRootFor(project), String(sessionId ?? ""));
  return publicProjectNavigation();
});
ipcMain.handle("codepilot:projects:remove", async (_event, projectId) => {
  await assertProjectMutationAvailable();
  const id = String(projectId ?? "");
  if (id === projectRegistry.snapshot().selectedProjectId) {
    await switchProject(projectRegistry.snapshot().defaultProjectId);
  }
  await runtimeCoordinator.discardProject(id);
  await projectRegistry.remove(id);
  return publicProjects();
});
ipcMain.handle("codepilot:projects:worktrees:create", async (_event, projectId, value) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  const inspected = await gitWorkspaceService.inspect(project.workspacePath);
  if (!inspected.available || !samePath(inspected.repositoryPath, project.workspacePath)) {
    throw new Error("创建工作树需要以 Git 仓库根目录作为项目工作区。");
  }
  const slug = String(value?.slug ?? "").trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,47}$/i.test(slug)) throw new Error("工作树名称只能包含字母、数字、点、横线和下划线。");
  const destination = await dialog.showSaveDialog(mainWindow, {
    title: "选择永久工作树位置",
    defaultPath: join(dirname(project.workspacePath), `${basename(project.workspacePath)}-${slug}`),
    buttonLabel: "创建工作树",
    properties: ["createDirectory", "showOverwriteConfirmation"]
  });
  if (destination.canceled || !destination.filePath) return { cancelled: true };
  const created = await gitWorkspaceService.createPermanent({
    workspacePath: project.workspacePath,
    targetPath: destination.filePath,
    branch: `codepilot/${slug}`
  });
  try {
    await projectRegistry.addTarget(project.id, created);
  } catch (error) {
    await gitWorkspaceService.removePermanent({
      repositoryPath: inspected.repositoryPath,
      worktreePath: created.workspacePath,
      baseCommit: created.baseCommit
    }).catch(() => {});
    throw error;
  }
  return projectActionState(project.id);
});
ipcMain.handle("codepilot:projects:worktrees:create-isolated", async (_event, projectId) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  const inspected = await gitWorkspaceService.inspect(project.workspacePath);
  if (!inspected.available || !samePath(inspected.repositoryPath, project.workspacePath)) {
    throw new Error("隔离工作树需要以 Git 仓库根目录作为项目工作区。");
  }
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const worktreeRoot = join(app.getPath("userData"), "worktrees", project.id);
  const workspacePath = join(worktreeRoot, `task-${suffix}`);
  await mkdir(worktreeRoot, { recursive: true });
  const created = await gitWorkspaceService.createPermanent({
    workspacePath: project.workspacePath,
    targetPath: workspacePath,
    branch: `codepilot/task-${suffix}`
  });
  try {
    const target = await projectRegistry.addTarget(project.id, created);
    return Object.freeze({ workspaceTargetId: target.id });
  } catch (error) {
    await gitWorkspaceService.removePermanent({
      repositoryPath: inspected.repositoryPath,
      worktreePath: created.workspacePath,
      baseCommit: created.baseCommit
    }).catch(() => {});
    throw error;
  }
});
ipcMain.handle("codepilot:projects:worktrees:remove", async (_event, projectId, targetId) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  const target = projectRegistry.target(project.id, String(targetId ?? ""));
  if (!target || target.kind !== "worktree") throw new Error("Workspace target not found");
  const actionState = await projectActionState(project.id);
  const targetState = actionState.targets.find((candidate) => candidate.id === target.id);
  if (targetState?.taskCount) throw new Error("这个工作树仍绑定任务，请先保留工作树或移除相关项目记录。");
  if (project.id === currentProject.id && target.id === currentTarget.id) {
    await runtimeCoordinator.switchProject(project.id, { workspaceTargetId: project.targets[0].id });
    currentProject = runtimeCoordinator.currentProject;
    currentTarget = runtimeCoordinator.currentTarget;
  }
  await runtimeCoordinator.discardProject(project.id, target.id);
  const inspected = await gitWorkspaceService.inspect(project.workspacePath);
  await gitWorkspaceService.removePermanent({
    repositoryPath: inspected.repositoryPath,
    worktreePath: target.workspacePath,
    baseCommit: target.baseCommit
  });
  await projectRegistry.removeTarget(project.id, target.id);
  return projectActionState(project.id);
});
ipcMain.handle("codepilot:projects:github:state", async (_event, projectId) => {
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  return githubCliBridge.inspect(githubWorkspaceFor(project));
});
ipcMain.handle("codepilot:projects:github:connect", async (_event, projectId, value) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  return githubCliBridge.connect(githubWorkspaceFor(project), value);
});
ipcMain.handle("codepilot:projects:github:push", async (_event, projectId) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  return githubCliBridge.push(githubWorkspaceFor(project));
});
ipcMain.handle("codepilot:projects:github:create-pr", async (_event, projectId, value) => {
  await assertProjectMutationAvailable();
  const project = projectRegistry.get(String(projectId ?? ""));
  if (!project) throw new Error("Project not found");
  return githubCliBridge.createPullRequest(githubWorkspaceFor(project), value);
});
ipcMain.handle("codepilot:projects:choose-workspace", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择 CodePilot 项目工作区",
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  cleanExpiredProjectSelections();
  const selectionId = randomUUID();
  const workspacePath = result.filePaths[0];
  pendingProjectSelections.set(selectionId, { workspacePath, createdAt: Date.now() });
  return Object.freeze({
    selectionId,
    displayPath: displayWorkspacePath(workspacePath),
    suggestedName: basename(workspacePath) || "本地项目"
  });
});
ipcMain.handle("codepilot:projects:create", async (_event, value) => {
  cleanExpiredProjectSelections();
  const selectionId = typeof value?.selectionId === "string" ? value.selectionId : "";
  const selection = pendingProjectSelections.get(selectionId);
  if (!selection) throw new Error("项目工作区选择已失效，请重新选择。");
  pendingProjectSelections.delete(selectionId);
  const project = await projectRegistry.add(selection.workspacePath, { name: value?.name });
  return switchProject(project.id);
});
async function createWindow(shellOrigin) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 720,
    title: APP_BRAND.name,
    icon: APP_BRAND.windowIconPath,
    backgroundColor: "#090b10",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(desktopDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://") || isWorkspacePreviewUrl(url, runtimeCoordinator?.currentRuntime.previewOrigin)) shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (new URL(url).origin !== shellOrigin) event.preventDefault();
  });
  mainWindow.webContents.on("preload-error", (_event, _preloadPath, error) => {
    console.error(`CodePilot preload failed: ${error.message}`);
  });

  await mainWindow.loadURL(shellOrigin);
  updateUnreadBadge(0);
  if (isDevelopment) mainWindow.webContents.openDevTools({ mode: "detach" });
}

async function boot() {
  let initialRuntime = null;
  try {
    const demoWorkspacePath = await ensureDemoWorkspace({
      appRoot,
      resourcesPath: process.resourcesPath,
      userDataPath: app.getPath("userData"),
      isPackaged: app.isPackaged
    });
    projectRegistry = new ProjectRegistry({
      registryPath: join(app.getPath("userData"), "projects.json"),
      defaultWorkspacePath: demoWorkspacePath
    });
    await projectRegistry.load();
    currentProject = projectRegistry.current();
    currentTarget = projectRegistry.target(currentProject.id, projectRegistry.snapshot().selectedTargetId) ?? currentProject.targets[0];
    initialRuntime = await startProjectRuntime(currentProject, currentTarget);
    const initialState = await runtimeProjectState(initialRuntime);
    if (initialState.id !== currentProject.id) throw new Error("Initial Runtime Project identity mismatch");
    if (initialState.workspaceTargetId !== currentTarget.id) throw new Error("Initial Runtime Workspace identity mismatch");
    initialRuntime.previewOrigin = initialState.previewOrigin;
    runtimeRouter = createDesktopRuntimeRouter({ upstreamPort: initialRuntime.port });
    const shellOrigin = await runtimeRouter.listen();
    runtimeCoordinator = new ProjectRuntimeCoordinator({
      currentProject,
      currentTarget,
      currentRuntime: initialRuntime,
      router: runtimeRouter,
      resolveProject: (projectId) => projectRegistry.get(projectId),
      resolveTarget: resolveProjectWorkspaceTarget,
      inspectRuntime: runtimeProjectState,
      startRuntime: startProjectRuntime,
      stopRuntime: stopProjectRuntime,
      selectProject: (projectId, targetId) => projectRegistry.select(projectId, targetId)
    });
    await createWindow(shellOrigin);
    const warmCandidates = projectRegistry.snapshot().projects
      .filter((project) => project.id !== currentProject.id)
      .slice(0, 2);
    void Promise.allSettled(warmCandidates.map((project) => runtimeCoordinator.warmProject(project.id)));
  } catch (error) {
    if (!runtimeCoordinator && initialRuntime) await stopProjectRuntime(initialRuntime).catch(() => {});
    await runtimeRouter?.close().catch(() => {});
    await dialog.showMessageBox({
      type: "error",
      title: "CodePilot 无法启动",
      message: "本地 Agent Runtime 启动失败。",
      detail: publicRuntimeStartupDetail(error)
    });
    app.quit();
  }
}

app.whenReady().then(boot);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  quitting = true;
  void runtimeCoordinator?.shutdown();
  void runtimeRouter?.close();
});
app.on("activate", () => {
  if (!quitting && BrowserWindow.getAllWindows().length === 0 && runtimeRouter?.origin) void createWindow(runtimeRouter.origin);
});
