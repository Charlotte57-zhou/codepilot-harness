const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("codepilotDesktop", Object.freeze({
  platform: process.platform,
  desktop: true,
  setUnreadCount(count) {
    ipcRenderer.send("codepilot:set-unread-count", Number(count) || 0);
  },
  listProjects() {
    return ipcRenderer.invoke("codepilot:projects:list");
  },
  listProjectNavigation() {
    return ipcRenderer.invoke("codepilot:projects:navigation");
  },
  chooseProjectWorkspace() {
    return ipcRenderer.invoke("codepilot:projects:choose-workspace");
  },
  createProject(value = {}) {
    return ipcRenderer.invoke("codepilot:projects:create", {
      selectionId: String(value.selectionId ?? ""),
      name: String(value.name ?? "")
    });
  },
  switchProject(projectId, navigationIntent = {}) {
    return ipcRenderer.invoke("codepilot:projects:switch", String(projectId ?? ""), {
      newTask: navigationIntent.newTask === true,
      sessionId: typeof navigationIntent.sessionId === "string" ? navigationIntent.sessionId : "",
      workspaceTargetId: typeof navigationIntent.workspaceTargetId === "string" ? navigationIntent.workspaceTargetId : ""
    });
  },
  getProjectActions(projectId) {
    return ipcRenderer.invoke("codepilot:projects:actions", String(projectId ?? ""));
  },
  setProjectPinned(projectId, pinned) {
    return ipcRenderer.invoke("codepilot:projects:pin", String(projectId ?? ""), pinned === true);
  },
  openProjectWorkspace(projectId, targetId = "") {
    return ipcRenderer.invoke("codepilot:projects:open", String(projectId ?? ""), String(targetId ?? ""));
  },
  renameProject(projectId, name) {
    return ipcRenderer.invoke("codepilot:projects:rename", String(projectId ?? ""), String(name ?? ""));
  },
  archiveProjectChats(projectId) {
    return ipcRenderer.invoke("codepilot:projects:archive-chats", String(projectId ?? ""));
  },
  restoreArchivedSession(projectId, sessionId) {
    return ipcRenderer.invoke("codepilot:projects:archived:restore", String(projectId ?? ""), String(sessionId ?? ""));
  },
  deleteArchivedSession(projectId, sessionId) {
    return ipcRenderer.invoke("codepilot:projects:archived:delete", String(projectId ?? ""), String(sessionId ?? ""));
  },
  removeProject(projectId) {
    return ipcRenderer.invoke("codepilot:projects:remove", String(projectId ?? ""));
  },
  createProjectWorktree(projectId, slug) {
    return ipcRenderer.invoke("codepilot:projects:worktrees:create", String(projectId ?? ""), { slug: String(slug ?? "") });
  },
  createIsolatedProjectWorktree(projectId) {
    return ipcRenderer.invoke("codepilot:projects:worktrees:create-isolated", String(projectId ?? ""));
  },
  removeProjectWorktree(projectId, targetId) {
    return ipcRenderer.invoke("codepilot:projects:worktrees:remove", String(projectId ?? ""), String(targetId ?? ""));
  },
  getProjectGitHubState(projectId) {
    return ipcRenderer.invoke("codepilot:projects:github:state", String(projectId ?? ""));
  },
  connectProjectGitHubRepository(projectId, repository) {
    return ipcRenderer.invoke("codepilot:projects:github:connect", String(projectId ?? ""), {
      repository: String(repository ?? "").slice(0, 201)
    });
  },
  pushProjectGitHubBranch(projectId) {
    return ipcRenderer.invoke("codepilot:projects:github:push", String(projectId ?? ""));
  },
  createProjectGitHubPullRequest(projectId, value = {}) {
    return ipcRenderer.invoke("codepilot:projects:github:create-pr", String(projectId ?? ""), {
      title: String(value.title ?? "").slice(0, 201),
      body: String(value.body ?? "").slice(0, 8001),
      base: String(value.base ?? "").slice(0, 81)
    });
  }
}));
