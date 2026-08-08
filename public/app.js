import { buildRunViewModels } from "./run-view-model.js";
import { buildRunTraceViewModel } from "./run-trace-view-model.js";
import { buildTodoListViewModel } from "./todo-list-view-model.js";
import { projectTaskProgressReferences } from "./task-reference-projector.js";
import { formatBudgetNotice, formatRunSummary } from "./run-summary-view-model.js";
import { deriveRunAttachment } from "./run-reconnect.js";
import {
  INSPECTOR_COMPACT_QUERY,
  createInspectorLayout,
  setInspectorOpen,
  toggleInspector,
  transitionInspectorViewport
} from "./workspace-layout.js";
import {
  createPrimaryNavigation,
  derivePrimaryNavigation,
  setPrimaryView
} from "./primary-navigation.js";
import { hydrateIcons, icon } from "./icons.js";
import { createConfirmationController } from "./confirmation-dialog.js";
import { buildRunChangeSet, compactDiffRows, fileReviewMeta, previewArtifactForFile } from "./file-change-view-model.js";
import {
  presentAgentError,
  presentModelAttempt,
  presentRunState,
  presentToolCompletion,
  projectModelRequest
} from "./event-presentation.js";
import {
  baselineSeenTerminalEventIds,
  countUnreadCompletions,
  deriveSessionAttention,
  persistSeenTerminalEventIds,
  restoreSeenTerminalEventIds
} from "./session-attention.js";
import {
  buildConversationTurns,
  persistConversationViewports,
  restoreConversationViewports,
  updateConversationViewport
} from "./conversation-navigation.js";
import { redactLocalPaths } from "./privacy-display.js";

const inspectorMedia = window.matchMedia(INSPECTOR_COMPACT_QUERY);
const sidebarMedia = window.matchMedia("(max-width: 1023px)");
const seenTerminalsStorageKey = "codepilot.seen-terminal-events.v1";
const storedSeenTerminals = localStorage.getItem(seenTerminalsStorageKey);
const conversationViewportsStorageKey = "codepilot.conversation-viewports.v1";
const themeStorageKey = "codepilot.theme.v1";
const collapsedProjectsStorageKey = "codepilot.collapsed-projects.v1";
const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
const storedTheme = localStorage.getItem(themeStorageKey);
const initialTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : (systemTheme.matches ? "dark" : "light");
document.documentElement.dataset.theme = initialTheme;
function restoreCollapsedProjects(value) {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string" && id.length <= 128).slice(0, 100) : []);
  } catch {
    return new Set();
  }
}
const state = { project: { defaultProjectId: null, currentProjectId: null, currentWorkspaceTargetId: null, projects: [] }, projectSwitch: null, projectActions: new Map(), collapsedProjectIds: restoreCollapsedProjects(localStorage.getItem(collapsedProjectsStorageKey)), managedProjectId: null, session: null, events: [], conversationCache: new Map(), sessions: { active: [], archived: [] }, sessionAttentionInitialized: storedSeenTerminals !== null, seenTerminalEventIds: restoreSeenTerminalEventIds(storedSeenTerminals), conversationViewports: restoreConversationViewports(localStorage.getItem(conversationViewportsStorageKey)), capabilities: null, selectedSkill: null, skillQuery: "", mcpQuery: "", mcpSearchTimer: null, mcpAuthPollers: new Map(), mcpTokenProductId: null, mcpRegistry: { servers: [], loading: false, loaded: false, error: null, sourceUrl: null, preview: true }, pendingPermission: null, providerCatalog: {}, modelConfig: null, permissionMode: "ask", attachments: [], running: false, pollTimer: null, elapsedTimer: null, heartbeatTimer: null, runStartEventCount: 0, openTraces: new Set(), openToolBatches: new Set(), openTodoLists: new Set(), inspectorView: "runtime", selectedChangeRunId: null, reviewContextMode: "compact", inspectorLayout: createInspectorLayout(inspectorMedia.matches), sidebarOpen: false, primaryNavigation: createPrimaryNavigation() };
let dialogReturnFocus = null;
let skillDetailReturnFocus = null;
let inspectorReturnFocus = null;
let runtimeNoticeTimer = null;
let fileDragDepth = 0;
let viewportSaveFrame = null;
let restoringConversationViewport = false;
let sessionLoadEpoch = 0;
let projectWorkspaceSelection = null;
let projectDialogReturnFocus = null;
let githubConnectionState = null;
let creatingIsolatedWorktree = false;

const elements = {
  sidebar: document.querySelector(".sidebar"),
  sidebarToggle: document.querySelector("#sidebar-toggle"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  addProject: document.querySelector("#add-project"),
  projectCrumb: document.querySelector("#project-crumb"),
  newSession: document.querySelector("#new-session"),
  openSkills: document.querySelector("#open-skills"),
  openSkillsMobile: document.querySelector("#open-skills-mobile"),
  openMcp: document.querySelector("#open-mcp"),
  openMcpMobile: document.querySelector("#open-mcp-mobile"),
  list: document.querySelector("#session-list"),
  title: document.querySelector("#session-title"),
  empty: document.querySelector("#empty-state"),
  timeline: document.querySelector("#timeline"),
  turnNavigation: document.querySelector("#turn-navigation"),
  form: document.querySelector("#task-form"),
  todoList: document.querySelector("#todo-list"),
  input: document.querySelector("#task-input"),
  send: document.querySelector("#send-task"),
  attachmentInput: document.querySelector("#attachment-input"),
  attachFile: document.querySelector("#attach-file"),
  attachmentList: document.querySelector("#attachment-list"),
  workspaceTargetControl: document.querySelector("#workspace-target-control"),
  workspaceTargetTrigger: document.querySelector("#workspace-target-trigger"),
  workspaceTargetLabel: document.querySelector("#workspace-target-label"),
  workspaceTargetMenu: document.querySelector("#workspace-target-menu"),
  fileDropOverlay: document.querySelector("#file-drop-overlay"),
  permissionModeTrigger: document.querySelector("#permission-mode-trigger"),
  permissionModeIcon: document.querySelector("#permission-mode-icon"),
  permissionModeLabel: document.querySelector("#permission-mode-label"),
  permissionModeMenu: document.querySelector("#permission-mode-menu"),
  quickModelTrigger: document.querySelector("#quick-model-trigger"),
  quickModelLabel: document.querySelector("#quick-model-label"),
  quickModelMenu: document.querySelector("#quick-model-menu"),
  quickModelSelect: document.querySelector("#quick-model-select"),
  quickModelOptions: document.querySelector("#quick-model-options"),
  quickReasoningRow: document.querySelector("#quick-reasoning-row"),
  quickReasoningSelect: document.querySelector("#quick-reasoning-select"),
  quickReasoningOptions: document.querySelector("#quick-reasoning-options"),
  quickCapabilitySummary: document.querySelector("#quick-capability-summary"),
  toolActivity: document.querySelector("#tool-activity"),
  toolCount: document.querySelector("#tool-count"),
  skillsLayer: document.querySelector("#skills-layer"),
  skillsGrid: document.querySelector("#skills-grid"),
  skillsSearch: document.querySelector("#skills-search"),
  skillsCount: document.querySelector("#skills-count"),
  skillsResultCount: document.querySelector("#skills-result-count"),
  skillsCatalogStatus: document.querySelector("#skills-catalog-status"),
  skillDetailLayer: document.querySelector("#skill-detail-layer"),
  skillDetailPanel: document.querySelector("#skill-detail-panel"),
  mcpLayer: document.querySelector("#mcp-layer"),
  mcpSearch: document.querySelector("#mcp-search"),
  mcpNativeGrid: document.querySelector("#mcp-native-grid"),
  mcpGrid: document.querySelector("#mcp-grid"),
  mcpCount: document.querySelector("#mcp-count"),
  mcpConfiguredCount: document.querySelector("#mcp-configured-count"),
  mcpAvailableCount: document.querySelector("#mcp-available-count"),
  mcpToolCount: document.querySelector("#mcp-tool-count"),
  mcpCatalogStatus: document.querySelector("#mcp-catalog-status"),
  mcpResultCount: document.querySelector("#mcp-result-count"),
  mcpRegistryStatus: document.querySelector("#mcp-registry-status"),
  mcpMarketplaceGrid: document.querySelector("#mcp-marketplace-grid"),
  refreshMcpRegistry: document.querySelector("#refresh-mcp-registry"),
  mcpFeaturedCatalog: document.querySelector("#mcp-featured-catalog"),
  mcpFeaturedCount: document.querySelector("#mcp-featured-count"),
  mcpTokenDialog: document.querySelector("#mcp-token-dialog"),
  mcpTokenForm: document.querySelector("#mcp-token-form"),
  mcpTokenTitle: document.querySelector("#mcp-token-title"),
  mcpTokenInput: document.querySelector("#mcp-token-input"),
  mcpTokenError: document.querySelector("#mcp-token-error"),
  mcpTokenSubmit: document.querySelector("#mcp-token-submit"),
  mcpTokenCancel: document.querySelector("#mcp-token-cancel"),
  mcpTokenClose: document.querySelector("#mcp-token-close"),
  transcript: document.querySelector("#transcript-summary"),
  transcriptButton: document.querySelector("#open-transcript"),
  contextUsage: document.querySelector("#context-usage"),
  contextUsageValue: document.querySelector("#context-usage-value"),
  contextMeterFill: document.querySelector("#context-meter-fill"),
  workspace: document.querySelector("#workspace-main"),
  inspector: document.querySelector("#runtime-inspector"),
  inspectorToggle: document.querySelector("#inspector-toggle"),
  inspectorClose: document.querySelector("#inspector-close"),
  inspectorScrim: document.querySelector("#inspector-scrim"),
  inspectorTitle: document.querySelector("#inspector-title"),
  inspectorSubtitle: document.querySelector("#inspector-subtitle"),
  changeReview: document.querySelector("#change-review"),
  usageSource: document.querySelector("#usage-source"),
  usageTotal: document.querySelector("#usage-total"),
  usageInput: document.querySelector("#usage-input"),
  usageOutput: document.querySelector("#usage-output"),
  usageCacheRead: document.querySelector("#usage-cache-read"),
  usageCacheWrite: document.querySelector("#usage-cache-write"),
  permission: document.querySelector("#permission-layer"),
  eventLog: document.querySelector("#event-log-layer"),
  settings: document.querySelector("#settings-layer"),
  runtimeSettings: document.querySelector("#runtime-settings-layer"),
  workspaceSettingsClose: document.querySelector("#close-workspace-settings"),
  settingsNav: document.querySelector(".workspace-settings-nav"),
  activityContent: document.querySelector("#activity-content"),
  archivedSessionList: document.querySelector("#archived-session-list"),
  modelForm: document.querySelector("#model-form"),
  modelProvider: document.querySelector("#model-provider"),
  modelBaseUrl: document.querySelector("#model-base-url"),
  modelName: document.querySelector("#model-name"),
  modelApiKey: document.querySelector("#model-api-key"),
  clearApiKey: document.querySelector("#clear-api-key"),
  budgetMaxTurns: document.querySelector("#budget-max-turns"),
  budgetMaxRetries: document.querySelector("#budget-max-retries"),
  budgetDeadlineMinutes: document.querySelector("#budget-deadline-minutes"),
  budgetMaxOutputTokens: document.querySelector("#budget-max-output-tokens"),
  budgetCompactionOutputTokens: document.querySelector("#budget-compaction-output-tokens"),
  budgetEffectiveOutput: document.querySelector("#budget-effective-output"),
  scroll: document.querySelector("#conversation-scroll"),
  runtimeNotice: document.querySelector("#runtime-notice"),
  projectCreateDialog: document.querySelector("#project-create-dialog"),
  projectCreateForm: document.querySelector("#project-create-form"),
  projectCreateName: document.querySelector("#project-create-name"),
  projectWorkspacePicker: document.querySelector("#project-workspace-picker"),
  projectWorkspacePath: document.querySelector("#project-workspace-path"),
  projectCreateError: document.querySelector("#project-create-error"),
  projectCreateSubmit: document.querySelector("#project-create-submit"),
  projectCreateCancel: document.querySelector("#project-create-cancel"),
  projectCreateClose: document.querySelector("#project-create-close"),
  projectEditDialog: document.querySelector("#project-edit-dialog"),
  projectEditForm: document.querySelector("#project-edit-form"),
  projectEditName: document.querySelector("#project-edit-name"),
  projectEditError: document.querySelector("#project-edit-error"),
  projectEditSubmit: document.querySelector("#project-edit-submit"),
  projectEditCancel: document.querySelector("#project-edit-cancel"),
  projectEditClose: document.querySelector("#project-edit-close"),
  worktreeDialog: document.querySelector("#worktree-dialog"),
  worktreeForm: document.querySelector("#worktree-form"),
  worktreeStatus: document.querySelector("#worktree-status"),
  worktreeList: document.querySelector("#worktree-list"),
  worktreeSlug: document.querySelector("#worktree-slug"),
  worktreeError: document.querySelector("#worktree-error"),
  worktreeCreate: document.querySelector("#worktree-create"),
  worktreeCancel: document.querySelector("#worktree-cancel"),
  worktreeClose: document.querySelector("#worktree-close"),
  githubDialog: document.querySelector("#github-dialog"),
  githubStatus: document.querySelector("#github-status"),
  githubConnectForm: document.querySelector("#github-connect-form"),
  githubRepositoryInput: document.querySelector("#github-repository-input"),
  githubConnect: document.querySelector("#github-connect"),
  githubRepository: document.querySelector("#github-repository"),
  githubRepositoryName: document.querySelector("#github-repository-name"),
  githubBranch: document.querySelector("#github-branch"),
  githubPrState: document.querySelector("#github-pr-state"),
  githubChecksSection: document.querySelector("#github-checks-section"),
  githubChecksSummary: document.querySelector("#github-checks-summary"),
  githubChecks: document.querySelector("#github-checks"),
  githubPrForm: document.querySelector("#github-pr-form"),
  githubPrTitle: document.querySelector("#github-pr-title"),
  githubPrBase: document.querySelector("#github-pr-base"),
  githubPrBody: document.querySelector("#github-pr-body"),
  githubError: document.querySelector("#github-error"),
  githubPush: document.querySelector("#github-push"),
  githubCreatePr: document.querySelector("#github-create-pr"),
  githubDone: document.querySelector("#github-done"),
  githubClose: document.querySelector("#github-close"),
  confirmationDialog: document.querySelector("#confirmation-dialog"),
  confirmationTitle: document.querySelector("#confirmation-title"),
  confirmationMessage: document.querySelector("#confirmation-message"),
  confirmationDetail: document.querySelector("#confirmation-detail"),
  confirmationDetailMeta: document.querySelector("#confirmation-detail-meta"),
  confirmationConfirm: document.querySelector("#confirmation-confirm"),
  confirmationCancel: document.querySelector("#confirmation-cancel"),
  confirmationClose: document.querySelector("#confirmation-close")
};
hydrateIcons(document);
const confirmations = createConfirmationController({
  dialog: elements.confirmationDialog,
  title: elements.confirmationTitle,
  message: elements.confirmationMessage,
  detail: elements.confirmationDetail,
  detailMeta: elements.confirmationDetailMeta,
  confirmButton: elements.confirmationConfirm,
  cancelButton: elements.confirmationCancel,
  closeButton: elements.confirmationClose
});

function currentProject() {
  return state.project.projects.find((project) => project.id === state.project.currentProjectId) ?? state.project.projects[0] ?? null;
}

function navigationProjectId() {
  return state.projectSwitch?.projectId ?? state.project.currentProjectId;
}

function persistCollapsedProjects() {
  localStorage.setItem(collapsedProjectsStorageKey, JSON.stringify([...state.collapsedProjectIds]));
}

function renderComposerWorkspaceTarget() {
  const project = currentProject();
  const targets = window.codepilotDesktop?.switchProject ? (project?.targets ?? []) : [];
  elements.workspaceTargetControl.hidden = targets.length === 0;
  if (!targets.length) {
    elements.workspaceTargetMenu.replaceChildren();
    return;
  }
  const currentTarget = targets.find((target) => target.id === state.project.currentWorkspaceTargetId) ?? targets[0];
  elements.workspaceTargetLabel.textContent = currentTarget.kind === "main" ? "主工作区" : (currentTarget.branch || "工作树");
  elements.workspaceTargetMenu.innerHTML = targets.map((target) => {
    const current = target.id === state.project.currentWorkspaceTargetId;
    const label = target.kind === "main" ? "主工作区" : (target.branch || "工作树");
    const detail = current ? "当前任务工作区" : "在此工作树中新建任务";
    return `<button type="button" role="menuitemradio" data-workspace-target="${escapeHtml(target.id)}" aria-checked="${String(current)}"><span class="workspace-target-option-icon" aria-hidden="true">${icon(target.kind === "main" ? "folder" : "git-branch")}</span><span class="workspace-target-option-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></span><span class="workspace-target-option-check" aria-hidden="true">${current ? icon("check") : ""}</span></button>`;
  }).join("") + `<button type="button" role="menuitem" data-workspace-target="__create_isolated_worktree__"><span class="workspace-target-option-icon" aria-hidden="true">${icon("plus")}</span><span class="workspace-target-option-copy"><strong>新建隔离工作树</strong><span>为新任务创建独立 Git worktree</span></span><span></span></button>`;
  elements.workspaceTargetTrigger.disabled = state.running || Boolean(state.projectSwitch) || creatingIsolatedWorktree;
  elements.workspaceTargetControl.title = "选择已有 Git worktree，或为新任务创建隔离 worktree";
}

function rememberCurrentConversation() {
  if (!state.session?.id) return;
  state.conversationCache.delete(state.session.id);
  state.conversationCache.set(state.session.id, {
    session: { ...state.session },
    events: [...state.events],
    capabilities: state.capabilities
  });
  while (state.conversationCache.size > 8) {
    state.conversationCache.delete(state.conversationCache.keys().next().value);
  }
}

function showCachedConversation(sessionId) {
  const cached = state.conversationCache.get(sessionId);
  if (!cached) return false;
  state.session = { ...cached.session };
  state.events = [...cached.events];
  state.capabilities = cached.capabilities;
  const attachment = deriveRunAttachment(state.events, state.session);
  state.running = attachment.running;
  state.runStartEventCount = attachment.runStartEventCount;
  render({ scrollToLatest: false });
  restoreConversationViewport(sessionId);
  return true;
}

function closeProjectMenus({ restoreFocus = false } = {}) {
  document.querySelectorAll(".project-menu").forEach((menu) => {
    const toggle = menu.closest(".project-navigation-group")?.querySelector(".project-menu-toggle");
    const wasOpen = !menu.hidden;
    menu.hidden = true;
    toggle?.setAttribute("aria-expanded", "false");
    if (restoreFocus && wasOpen) toggle?.focus();
  });
}

function renderSidebarDrawer() {
  const compact = sidebarMedia.matches;
  const open = compact && state.sidebarOpen;
  elements.workspace.dataset.sidebarOpen = String(open);
  elements.sidebarToggle.hidden = !compact;
  elements.sidebarToggle.setAttribute("aria-expanded", String(open));
  elements.sidebarToggle.setAttribute("aria-label", open ? "关闭项目与任务导航" : "打开项目与任务导航");
  elements.sidebarScrim.hidden = !open;
  elements.sidebar.setAttribute("aria-hidden", String(compact && !open));
  elements.sidebar.inert = compact && !open;
}

function setSidebarOpen(open) {
  state.sidebarOpen = sidebarMedia.matches && Boolean(open);
  renderSidebarDrawer();
}

function renderProjectNavigation() {
  const selectedProjectId = navigationProjectId();
  const project = state.project.projects.find((candidate) => candidate.id === selectedProjectId) ?? currentProject();
  const switching = Boolean(state.projectSwitch);
  elements.projectCrumb.textContent = `项目 / ${project?.name ?? "本地项目"}`;
  const explicitProjects = state.project.projects.filter((candidate) => candidate.id !== state.project.defaultProjectId);
  const defaultProject = state.project.projects.find((candidate) => candidate.id === state.project.defaultProjectId);
  const projectGroups = explicitProjects.map((candidate) => {
    const runtimeSelected = candidate.id === state.project.currentProjectId;
    const tasks = runtimeSelected ? state.sessions.active : (candidate.tasks ?? []);
    const taskRows = tasks.map((session) => renderSessionItem(session, false, { projectId: candidate.id, actions: runtimeSelected })).join("");
    const collapsed = state.collapsedProjectIds.has(candidate.id);
    const taskListId = `project-tasks-${candidate.id}`;
    const menu = `<button class="project-menu-toggle" type="button" aria-label="${escapeHtml(candidate.name)} 项目操作" aria-haspopup="menu" aria-expanded="false" ${state.running || switching ? "disabled" : ""}>${icon("more")}</button><div class="project-menu" role="menu" hidden><button type="button" role="menuitem" data-project-action="pin">${candidate.pinned ? "取消置顶" : "置顶项目"}</button><button type="button" role="menuitem" data-project-action="open">在资源管理器中打开</button><button type="button" role="menuitem" data-project-action="worktrees">管理工作树</button><button type="button" role="menuitem" data-project-action="github">连接 GitHub</button><button type="button" role="menuitem" data-project-action="edit">编辑项目</button><button type="button" role="menuitem" data-project-action="archive">归档聊天</button><button type="button" role="menuitem" data-project-action="remove">移除项目</button></div>`;
    return `<section class="project-navigation-group" data-project-id="${escapeHtml(candidate.id)}"><div class="project-navigation-row"><button class="project-navigation-toggle" type="button" data-project-toggle="${escapeHtml(candidate.id)}" aria-expanded="${String(!collapsed)}" aria-controls="${escapeHtml(taskListId)}"><span aria-hidden="true">${icon(collapsed ? "folder" : "folder-open")}</span><span>${escapeHtml(candidate.name)}</span></button><button class="project-task-create" type="button" data-project-new="${escapeHtml(candidate.id)}" aria-label="在 ${escapeHtml(candidate.name)} 中新建任务" title="在项目中新建任务" ${state.running || switching ? "disabled" : ""}>${icon("plus")}</button>${menu}</div><div class="project-task-list" id="${escapeHtml(taskListId)}"${collapsed ? " hidden" : ""}>${taskRows || '<div class="project-task-empty">暂无任务</div>'}</div></section>`;
  }).join("");
  const recentTasks = state.project.currentProjectId === state.project.defaultProjectId
    ? state.sessions.active
    : (defaultProject?.tasks ?? []);
  const recentRows = recentTasks.map((session) => renderSessionItem(session, false, {
    projectId: state.project.defaultProjectId,
    actions: state.project.currentProjectId === state.project.defaultProjectId
  })).join("");
  elements.list.innerHTML = `${projectGroups || '<div class="project-list-empty">创建项目后，项目任务会显示在这里。</div>'}<div class="session-group-label recent-group-label">最近</div>${recentRows || '<div class="project-task-empty recent-empty">暂无最近任务</div>'}`;
  const desktopProjectsAvailable = Boolean(window.codepilotDesktop?.chooseProjectWorkspace && window.codepilotDesktop?.createProject);
  elements.addProject.disabled = state.running || switching || !desktopProjectsAvailable;
  elements.newSession.disabled = state.running || switching;
  elements.addProject.title = desktopProjectsAvailable ? "创建项目" : "桌面版支持创建本地项目";
  renderComposerWorkspaceTarget();
  renderPrimaryNavigation();
}

async function loadProjectContext() {
  const runtimeProject = await api("/api/project");
  const desktopProjects = window.codepilotDesktop?.listProjectNavigation
    ? await window.codepilotDesktop.listProjectNavigation()
    : { defaultProjectId: runtimeProject.id, currentProjectId: runtimeProject.id, projects: [{ ...runtimeProject, isDefault: true, tasks: [] }] };
  state.project = {
    defaultProjectId: desktopProjects.defaultProjectId ?? runtimeProject.id,
    currentProjectId: runtimeProject.id,
    currentWorkspaceTargetId: runtimeProject.workspaceTargetId,
    projects: desktopProjects.projects.some((project) => project.id === runtimeProject.id)
      ? desktopProjects.projects
      : [...desktopProjects.projects, runtimeProject]
  };
  renderProjectNavigation();
}

async function switchProjectFromNavigation(projectId, navigationIntent = {}) {
  if (!projectId || (projectId === state.project.currentProjectId && !navigationIntent.newTask && !navigationIntent.sessionId)) return;
  if (state.projectSwitch || !window.codepilotDesktop?.switchProject) return;
  if (state.running) {
    showRuntimeNotice("当前任务正在运行，任务结束后才能切换项目。");
    return;
  }
  rememberCurrentConversation();
  captureConversationViewport();
  state.projectSwitch = {
    projectId,
    sessionId: navigationIntent.sessionId ?? null,
    workspaceTargetId: navigationIntent.workspaceTargetId ?? null,
    newTask: navigationIntent.newTask === true,
    startedAt: performance.now()
  };
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
  stopHeartbeat();
  stopElapsedClock();
  sessionLoadEpoch += 1;
  if (!navigationIntent.sessionId || !showCachedConversation(navigationIntent.sessionId)) renderProjectNavigation();
  syncRunAction();
  try {
    const receipt = await window.codepilotDesktop.switchProject(projectId, navigationIntent);
    await loadCurrentProjectRuntime(receipt?.navigationIntent ?? navigationIntent);
  } catch (error) {
    showRuntimeNotice(error instanceof Error ? error.message : "项目切换失败，请重试。");
  } finally {
    state.projectSwitch = null;
    renderProjectNavigation();
    syncRunAction();
  }
}

function syncProjectCreateForm() {
  const nameReady = Boolean(elements.projectCreateName.value.trim());
  elements.projectCreateSubmit.disabled = state.running || Boolean(state.projectSwitch) || !nameReady || !projectWorkspaceSelection;
}

function setProjectCreateError(message = "") {
  elements.projectCreateError.textContent = message;
  elements.projectCreateError.hidden = !message;
}

function setProjectEditError(message = "") {
  elements.projectEditError.textContent = message;
  elements.projectEditError.hidden = !message;
}

function closeProjectEditDialog() {
  if (elements.projectEditDialog.open) elements.projectEditDialog.close();
  state.managedProjectId = null;
}

function openProjectEditDialog(project) {
  state.managedProjectId = project.id;
  elements.projectEditName.value = project.name;
  setProjectEditError();
  elements.projectEditDialog.showModal();
  requestAnimationFrame(() => elements.projectEditName.select());
}

function setWorktreeError(message = "") {
  elements.worktreeError.textContent = message;
  elements.worktreeError.hidden = !message;
}

function renderWorktreeDialog(actionState) {
  state.projectActions.set(actionState.project.id, actionState);
  const gitReady = actionState.git.available;
  elements.worktreeStatus.className = `worktree-status${gitReady ? " is-ready" : " is-unavailable"}`;
  elements.worktreeStatus.textContent = gitReady
    ? `Git · ${actionState.git.branch || "detached"}${actionState.git.dirty ? " · 主工作区有未提交更改" : ""}`
    : actionState.git.reason;
  elements.worktreeCreate.disabled = !gitReady || state.running;
  elements.worktreeSlug.disabled = !gitReady || state.running;
  elements.worktreeList.innerHTML = actionState.targets.map((target) => {
    const active = target.id === actionState.currentWorkspaceTargetId;
    const label = target.kind === "main" ? "主工作区" : target.branch || "永久工作树";
    return `<article class="worktree-row${active ? " is-active" : ""}" data-worktree-target="${escapeHtml(target.id)}"><span class="worktree-row-icon" aria-hidden="true">${icon(target.kind === "main" ? "folder" : "terminal")}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(target.displayPath)} · ${target.taskCount} 个任务${active ? " · 当前" : ""}</small></div><div class="worktree-row-actions"><button type="button" data-worktree-open="${escapeHtml(target.id)}">打开</button>${active ? "" : `<button type="button" data-worktree-switch="${escapeHtml(target.id)}">切换</button>`}${target.kind === "worktree" ? `<button type="button" data-worktree-remove="${escapeHtml(target.id)}" ${target.taskCount ? 'disabled title="仍有任务绑定此工作树"' : ""}>移除</button>` : ""}</div></article>`;
  }).join("");
}

async function openWorktreeDialog(projectId) {
  state.managedProjectId = projectId;
  elements.worktreeSlug.value = "";
  setWorktreeError();
  elements.worktreeStatus.className = "worktree-status";
  elements.worktreeStatus.textContent = "正在检查 Git 与工作树状态…";
  elements.worktreeList.innerHTML = "";
  elements.worktreeCreate.disabled = true;
  elements.worktreeDialog.showModal();
  try {
    renderWorktreeDialog(await window.codepilotDesktop.getProjectActions(projectId));
    if (!elements.worktreeSlug.disabled) elements.worktreeSlug.focus();
  } catch (error) {
    setWorktreeError(error instanceof Error ? error.message : "工作树状态读取失败。");
  }
}

function closeWorktreeDialog() {
  if (elements.worktreeDialog.open) elements.worktreeDialog.close();
  state.managedProjectId = null;
}

function setGitHubError(message = "") {
  elements.githubError.textContent = message;
  elements.githubError.hidden = !message;
}

function renderGitHubDialog(connection) {
  githubConnectionState = connection;
  const ready = connection?.available === true;
  elements.githubStatus.className = `github-status${ready ? " is-ready" : " is-unavailable"}`;
  elements.githubStatus.textContent = ready
    ? "GitHub CLI 已认证，当前仓库连接可用。"
    : connection?.message || "GitHub 连接状态不可用。";
  elements.githubConnectForm.hidden = ready || connection?.code !== "REMOTE_MISSING";
  elements.githubRepository.hidden = !ready;
  elements.githubPush.disabled = !ready || state.running;
  elements.githubCreatePr.disabled = !ready || Boolean(connection?.pullRequest) || state.running;
  elements.githubPrTitle.disabled = !ready || Boolean(connection?.pullRequest) || state.running;
  elements.githubPrBase.disabled = !ready || Boolean(connection?.pullRequest) || state.running;
  elements.githubPrBody.disabled = !ready || Boolean(connection?.pullRequest) || state.running;
  if (!ready) {
    elements.githubChecksSection.hidden = true;
    return;
  }
  elements.githubRepositoryName.textContent = `${connection.repository.name}${connection.repository.private ? " · Private" : " · Public"}`;
  elements.githubBranch.textContent = connection.branch;
  elements.githubPrState.textContent = connection.pullRequest ? `#${connection.pullRequest.number} · ${connection.pullRequest.state}` : "尚未创建";
  if (!elements.githubPrBase.value) elements.githubPrBase.value = connection.repository.defaultBranch || "main";
  if (!elements.githubPrTitle.value) elements.githubPrTitle.value = state.session?.title && state.session.title !== "新建任务" ? state.session.title : "CodePilot workspace changes";
  const checks = connection.pullRequest?.checks ?? [];
  elements.githubChecksSection.hidden = !connection.pullRequest;
  elements.githubChecksSummary.textContent = checks.length ? `${checks.filter((check) => check.bucket === "pass").length}/${checks.length} 通过` : "尚无 checks";
  elements.githubChecks.innerHTML = checks.length
    ? checks.map((check) => `<div class="github-check" data-bucket="${escapeHtml(check.bucket)}"><span aria-hidden="true"></span><strong>${escapeHtml(check.name)}</strong><small>${escapeHtml(check.state)}</small></div>`).join("")
    : '<div class="github-check-empty">GitHub 尚未返回 check run。</div>';
}

async function openGitHubDialog(projectId) {
  state.managedProjectId = projectId;
  githubConnectionState = null;
  elements.githubPrForm.reset();
  setGitHubError();
  elements.githubRepository.hidden = true;
  elements.githubConnectForm.hidden = true;
  elements.githubChecksSection.hidden = true;
  elements.githubStatus.className = "github-status";
  elements.githubStatus.textContent = "正在读取本机 GitHub 状态…";
  elements.githubPush.disabled = true;
  elements.githubCreatePr.disabled = true;
  elements.githubDialog.showModal();
  try {
    renderGitHubDialog(await window.codepilotDesktop.getProjectGitHubState(projectId));
  } catch (error) {
    setGitHubError(error instanceof Error ? error.message : "GitHub 状态读取失败。");
  }
}

function closeGitHubDialog() {
  if (elements.githubDialog.open) elements.githubDialog.close();
  githubConnectionState = null;
  state.managedProjectId = null;
}

function openProjectCreateDialog() {
  if (state.running || state.projectSwitch || !window.codepilotDesktop?.chooseProjectWorkspace || !window.codepilotDesktop?.createProject) return;
  projectDialogReturnFocus = document.activeElement;
  projectWorkspaceSelection = null;
  elements.projectCreateForm.reset();
  elements.projectWorkspacePath.textContent = "选择 Agent 可读取和编辑的文件夹";
  elements.projectWorkspacePicker.classList.remove("has-selection");
  setProjectCreateError();
  syncProjectCreateForm();
  elements.projectCreateDialog.showModal();
  queueMicrotask(() => elements.projectCreateName.focus());
}

function closeProjectCreateDialog({ restoreFocus = true } = {}) {
  if (elements.projectCreateDialog.open) elements.projectCreateDialog.close();
  projectWorkspaceSelection = null;
  if (restoreFocus && projectDialogReturnFocus?.isConnected) projectDialogReturnFocus.focus();
  projectDialogReturnFocus = null;
}

async function chooseProjectWorkspace() {
  if (state.running || !window.codepilotDesktop?.chooseProjectWorkspace) return;
  setProjectCreateError();
  const selection = await window.codepilotDesktop.chooseProjectWorkspace();
  if (!selection) return;
  projectWorkspaceSelection = selection;
  elements.projectWorkspacePath.textContent = selection.displayPath;
  elements.projectWorkspacePicker.classList.add("has-selection");
  if (!elements.projectCreateName.value.trim()) elements.projectCreateName.value = selection.suggestedName;
  syncProjectCreateForm();
}

function renderPrimaryNavigation() {
  const { skillsCurrent, mcpCurrent } = derivePrimaryNavigation(state.primaryNavigation);
  elements.sidebar.dataset.primaryView = state.primaryNavigation.view;
  for (const button of [elements.openSkills, elements.openSkillsMobile]) {
    if (skillsCurrent) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  for (const button of [elements.openMcp, elements.openMcpMobile]) {
    if (mcpCurrent) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
  document.querySelectorAll(".session-item").forEach((item) => {
    const row = item.querySelector(".session-row");
    const { sessionCurrent } = derivePrimaryNavigation(state.primaryNavigation, {
      currentSessionId: state.session?.id,
      candidateSessionId: item.dataset.sessionId
    });
    row.classList.toggle("active", sessionCurrent);
    if (sessionCurrent) row.setAttribute("aria-current", "page");
    else row.removeAttribute("aria-current");
  });
}

function renderInspectorLayout({ moveFocus = false } = {}) {
  const { compact, open } = state.inspectorLayout;
  const dockedReview = state.inspectorView === "review" && window.innerWidth > 980;
  const compactOverlay = compact && !dockedReview;
  const shouldRestoreFocus = moveFocus && !open && inspectorReturnFocus instanceof HTMLElement;
  if (shouldRestoreFocus) {
    inspectorReturnFocus.focus({ preventScroll: true });
    inspectorReturnFocus = null;
  }

  elements.workspace.dataset.inspectorOpen = String(open);
  elements.workspace.dataset.inspectorMode = compact ? "compact" : "wide";
  elements.inspectorToggle.setAttribute("aria-expanded", String(open));
  elements.inspector.setAttribute("aria-hidden", String(!open));
  elements.inspector.inert = !open;
  elements.inspectorScrim.hidden = !(compactOverlay && open);
  renderInspectorView();

  if (!moveFocus) return;
  if (open && compactOverlay) {
    inspectorReturnFocus = document.activeElement;
    requestAnimationFrame(() => elements.inspectorClose.focus());
  }
}

function updateInspectorOpen(open, options) {
  state.inspectorLayout = setInspectorOpen(state.inspectorLayout, open);
  renderInspectorLayout(options);
}

function renderDiffRow(row) {
  if (row.kind === "omitted") {
    const start = row.afterStart ?? row.beforeStart;
    const end = row.afterEnd ?? row.beforeEnd;
    const range = start === end ? start : `${start ?? "—"}–${end ?? "—"}`;
    return `<div class="diff-omitted" role="row"><span aria-hidden="true">•••</span><span>${range}</span><strong>${row.count} 行未修改内容</strong></div>`;
  }
  const prefix = row.kind === "addition" ? "+" : row.kind === "deletion" ? "−" : " ";
  const lineNumber = row.afterNumber ?? row.beforeNumber ?? "";
  return `<div class="diff-row is-${row.kind}" role="row"><span class="diff-marker" aria-label="${row.kind === "addition" ? "新增" : row.kind === "deletion" ? "删除" : "上下文"}">${prefix}</span><span class="diff-line-number">${lineNumber}</span><code>${escapeHtml(row.text)}</code></div>`;
}

function renderChangeReview() {
  const changeSet = buildRunChangeSet(state.events, state.selectedChangeRunId);
  if (!changeSet.files.length) {
    elements.changeReview.innerHTML = '<p class="placeholder">这一轮没有可审阅的文件修改。</p>';
    return;
  }
  const files = changeSet.files.map((file, index) => ({ file, index, meta: fileReviewMeta(file) }));
  const compact = state.reviewContextMode === "compact";
  const statusCopy = { added: "新增", deleted: "删除", modified: "修改" };
  elements.changeReview.innerHTML = `
    <div class="review-workbench">
      <header class="review-toolbar">
        <div class="review-summary"><strong>本轮变更</strong><span>${files.length} 个文件</span><b class="diff-add">+${changeSet.additions}</b><b class="diff-delete">−${changeSet.deletions}</b></div>
        <div class="review-toolbar-actions">
          <div class="review-context-switch" role="group" aria-label="Diff 上下文范围">
            <button type="button" data-review-context="compact" aria-pressed="${compact}">仅看变更</button>
            <button type="button" data-review-context="full" aria-pressed="${!compact}">完整文件</button>
          </div>
          <button class="review-tool-button" type="button" data-review-action="expand-all">全部展开</button>
          <button class="review-tool-button" type="button" data-review-action="collapse-all">全部折叠</button>
        </div>
      </header>
      <div class="review-body">
        <div class="review-file-list">
          ${files.map(({ file, index, meta }) => `<details class="review-file" ${index === 0 ? "open" : ""}>
            <summary>
              <span class="review-status is-${meta.status}">${statusCopy[meta.status][0]}</span>
              <span class="review-file-title"><strong>${displayHtml(meta.name)}</strong><small>${displayHtml(meta.directory || "项目根目录")}</small></span>
              <span class="review-file-state">${statusCopy[meta.status]}</span>
              <span class="review-file-diff"><b class="diff-add">+${file.additions}</b><b class="diff-delete">−${file.deletions}</b></span>
              <span class="review-file-chevron" aria-hidden="true">${icon("chevron-down")}</span>
            </summary>
            <div class="diff-view" role="table" aria-label="${displayHtml(meta.path)} 的统一差异">
              <div class="diff-column-head" role="row"><span></span><span>行</span><strong>代码</strong></div>
              ${(compact ? compactDiffRows(file.rows) : file.rows).map(renderDiffRow).join("")}
            </div>
          </details>`).join("")}
        </div>
      </div>
    </div>`;
}

function renderInspectorView() {
  const reviewing = state.inspectorView === "review";
  elements.workspace.dataset.inspectorView = state.inspectorView;
  elements.inspectorTitle.textContent = reviewing ? "审阅更改" : "运行详情";
  elements.inspectorSubtitle.textContent = reviewing ? "统一 Diff · 本轮文件变更" : "工具、事件与上下文";
  document.querySelectorAll("[data-runtime-inspector-section]").forEach((section) => { section.hidden = reviewing; });
  elements.changeReview.hidden = !reviewing;
  if (reviewing) renderChangeReview();
}

function openChangeReview(runId) {
  state.inspectorView = "review";
  state.selectedChangeRunId = runId;
  updateInspectorOpen(true, { moveFocus: true });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers ?? {}) },
    ...options
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

function displayHtml(value) {
  return escapeHtml(redactLocalPaths(value));
}

function displayTaskTitle(value) {
  const title = redactLocalPaths(value ?? "新建任务");
  return title === "新建对话" ? "新建任务" : title;
}

function renderInlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function normalizeMarkdownProse(value) {
  return String(value)
    .replace(/([:：])\s*-\s+/g, "$1\n- ")
    .replace(/([。；;])\s*(?=\*\*)/g, "$1\n\n");
}

function renderMarkdownText(value) {
  const lines = normalizeMarkdownProse(value).split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    while (index < lines.length && !lines[index].trim()) index += 1;
    if (index >= lines.length) break;
    const line = lines[index].trim();
    if (/^#{1,3}\s+/.test(line)) {
      blocks.push(`<h3>${renderInlineMarkdown(line.replace(/^#{1,3}\s+/, ""))}</h3>`);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderInlineMarkdown(lines[index].trim().replace(/^[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) {
        items.push(`<li>${renderInlineMarkdown(lines[index].trim().replace(/^\d+\.\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^#{1,3}\s+|^[-*]\s+|^\d+\.\s+/.test(lines[index].trim())) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(`<p>${paragraph.map(renderInlineMarkdown).join("<br>")}</p>`);
  }

  return blocks.join("");
}

function renderMarkdown(value) {
  const source = redactLocalPaths(value).replace(/\r\n?/g, "\n").trim();
  if (!source) return "";

  const blocks = [];
  const fencedCode = /```([\w+-]+)?\s*\n?([\s\S]*?)```/g;
  let cursor = 0;
  let match;
  while ((match = fencedCode.exec(source))) {
    blocks.push(renderMarkdownText(source.slice(cursor, match.index)));
    const language = match[1] ? ` data-language="${escapeHtml(match[1])}"` : "";
    const code = match[2].replace(/^\n|\n$/g, "");
    blocks.push(`<pre class="markdown-code"><code${language}>${escapeHtml(code)}</code></pre>`);
    cursor = match.index + match[0].length;
  }
  blocks.push(renderMarkdownText(source.slice(cursor)));

  return blocks.join("");
}

function eventTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp));
}

function formatElapsed(start, end = Date.now()) {
  return formatDuration(Math.max(0, new Date(end).getTime() - new Date(start).getTime()));
}

function formatDuration(milliseconds) {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  const totalSeconds = Math.floor(milliseconds / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`;
}

const eventLabels = {
  session_started: "会话已创建",
  user_message: "用户消息",
  run_preferences_selected: "运行配置已冻结",
  supervisor_run_started: "任务运行已开始",
  supervisor_run_completed: "任务运行已完成",
  supervisor_run_failed: "任务运行失败",
  supervisor_cancel_requested: "任务停止请求",
  supervisor_run_cancelled: "任务运行已停止",
  agent_cancel_requested: "任务停止请求",
  agent_cancelled: "任务已停止",
  agent_status: "Agent 状态",
  model_request_started: "模型请求",
  model_response_received: "模型响应",
  run_state_changed: "运行状态",
  agent_plan: "执行计划",
  agent_final: "最终回复",
  agent_error: "任务运行失败",
  model_attempt_failed: "模型请求异常",
  model_retry_scheduled: "模型请求重试",
  model_stream_started: "模型流开始",
  model_stream_completed: "模型流完成",
  model_text_delta: "文本片段",
  tool_call_delta: "工具参数片段",
  tool_call_ready: "工具调用已就绪",
  tool_requested: "工具调用",
  tool_completed: "工具结果",
  tool_cancelled: "工具结果",
  tool_result_recorded: "工具结果已记录",
  tool_result_repaired: "工具结果已修复",
  tool_batch_started: "工具批次开始",
  tool_batch_completed: "工具批次完成",
  agent_reasoning: "分析摘要",
  session_renamed: "会话已命名",
  session_snapshot_saved: "会话检查点已保存",
  permission_requested: "等待用户批准",
  permission_decision: "用户批准结果",
  permission_hook: "权限 Hook",
  permission_hook_error: "权限 Hook 异常",
  execution_requested: "执行任务已登记",
  execution_started: "本地执行已开始",
  execution_completed: "本地执行已完成",
  execution_failed: "本地执行失败",
  execution_cancelled: "本地执行已取消",
  execution_lost: "本地执行已失联",
  context_snipped: "上下文裁剪",
  context_microcompacted: "工具结果压缩",
  context_collapse_started: "上下文折叠开始",
  context_collapsed: "上下文已折叠",
  context_compact_started: "上下文摘要开始",
  context_compacted: "上下文摘要完成",
  context_rebuilt: "上下文能力快照已重建",
  context_post_compact_cleanup: "压缩后临时状态已清理",
  context_modifiers_merged: "上下文规则已合并",
  context_budget_evaluated: "上下文预算已评估",
  capability_snapshot_created: "能力快照已固化",
  token_usage_recorded: "模型用量已记录",
  skill_lifecycle_changed: "Skill 状态已更新",
  mcp_tools_refreshed: "MCP 工具已刷新",
  mcp_disconnected: "MCP 已断开",
  mcp_connection_failed: "MCP 连接失败",
  lifecycle_hook: "生命周期 Hook",
  reactive_recovery_applied: "上下文恢复已应用",
  reactive_recovery_failed: "上下文恢复失败",
  reactive_recovery_exhausted: "上下文恢复已耗尽",
  attachment_added: "附件已加入",
  automation_session_started: "自动化会话已开始",
  automation_browser_navigated: "浏览器已导航",
  automation_browser_clicked: "浏览器已点击",
  automation_browser_typed: "浏览器已输入",
  automation_artifact_created: "自动化产物已创建",
  automation_session_closed: "自动化会话已结束"
};

function eventLabel(event) {
  if (event.type === "model_attempt_failed" || event.type === "model_retry_scheduled") return presentModelAttempt(event).label;
  if (event.type === "agent_error") return presentAgentError(event).label;
  if (event.type === "run_state_changed") return presentRunState(event.data).label;
  if (event.type === "tool_completed" || event.type === "tool_cancelled") return `工具${presentToolCompletion(event).label}`;
  return eventLabels[event.type] ?? event.type;
}

function renderChangeCard(changeSet) {
  const visible = changeSet.files.slice(0, 3);
  const more = changeSet.files.length - visible.length;
  return `<section class="change-card" data-change-run-id="${escapeHtml(changeSet.runId)}"><div class="change-card-head"><span class="change-card-icon" aria-hidden="true">${icon("file")}</span><div><strong>${changeSet.reverted ? "已撤销" : "已编辑"} ${changeSet.files.length} 个文件</strong><span><b class="diff-add">+${changeSet.additions}</b> <b class="diff-delete">−${changeSet.deletions}</b></span></div><div class="change-actions"><button type="button" data-change-action="revert" ${changeSet.reverted ? "disabled" : ""}>${changeSet.reverted ? "已撤销" : "撤销"}</button><button class="is-primary" type="button" data-change-action="review">审阅</button></div></div><div class="change-file-list">${visible.map((file) => `<button type="button" data-change-action="review"><span>${displayHtml(file.path)}</span><span><b class="diff-add">+${file.additions}</b> <b class="diff-delete">−${file.deletions}</b></span></button>`).join("")}${more > 0 ? `<div class="change-more">另有 ${more} 个文件</div>` : ""}</div></section>`;
}

function renderArtifactLinks(changeSet) {
  if (changeSet.reverted) return "";
  const artifacts = changeSet.files.map((file) => previewArtifactForFile(file, state.modelConfig?.previewOrigin)).filter(Boolean);
  if (!artifacts.length) return "";
  return `<div class="artifact-output"><strong>产物位于：</strong>${artifacts.map((artifact) => `<a href="${escapeHtml(artifact.href)}" target="_blank" rel="noopener noreferrer" title="在浏览器中运行 ${escapeHtml(artifact.path)}"><span aria-hidden="true">〈/〉</span>${escapeHtml(artifact.label)}</a>`).join("")}</div>`;
}

function projectRunTaskText(text, runId) {
  const todo = buildTodoListViewModel(state.events, { runId });
  return projectTaskProgressReferences(text, todo);
}

function renderEvent(event) {
  const { type, timestamp, data } = event;
  const meta = `<div class="event-meta"><span class="event-kind">${escapeHtml(eventLabel(event))}</span><span>${eventTime(timestamp)}</span></div>`;
  if (type === "model_request_started") {
    const request = projectModelRequest(event, state.events);
    const elapsed = Math.floor(request.elapsedMs / 1_000);
    const elapsedValue = request.terminal ? String(elapsed) : `<span class="elapsed-value" data-elapsed-start="${escapeHtml(timestamp)}">${elapsed}</span>`;
    const dots = request.terminal ? "" : '<span class="waiting-dots" aria-label="等待中">...</span>';
    return `<article class="event"><div class="event-meta"><span class="event-kind">模型请求</span><span>${eventTime(timestamp)}</span></div><div class="message agent ${request.terminal ? "model-finished" : "model-waiting"}" data-outcome="${request.outcome}"><strong>${escapeHtml(request.title)}</strong><br><span class="muted">消息数：${data.messageCount} · ${escapeHtml(request.detail)} · ${request.terminal ? `耗时 ${elapsedValue} 秒` : `已等待 ${elapsedValue} 秒`}</span>${dots}</div></article>`;
  }

  if (type === "user_message") {
    const attachments = Array.isArray(data.attachments) && data.attachments.length
      ? `<div class="event-attachments">${data.attachments.map((item) => `<span class="event-attachment">${icon("file")}${escapeHtml(item.name)}</span>`).join("")}</div>`
      : "";
    return `<article class="event event-user" data-turn-id="${escapeHtml(String(event.id))}">${meta}<div class="user-turn">${attachments}<div class="message user">${escapeHtml(data.displayContent ?? data.content)}</div></div></article>`;
  }
  if (type === "run_state_changed") {
    const presentation = presentRunState(data);
    return `<article class="event">${meta}<div class="message agent" data-tone="${presentation.tone}"><strong>${displayHtml(presentation.label)}</strong><br><span class="muted">${displayHtml(data.detail)}</span></div></article>`;
  }
  if (type === "agent_plan") return `<article class="event">${meta}<div class="plan-message"><strong>Proposed plan</strong><ol>${data.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ol></div></article>`;
  if (type === "model_response_received") return `<article class="event">${meta}<div class="message agent"><strong>${escapeHtml(data.model ?? "模型")}</strong><br><span class="muted">模型响应已收到，正在整理最终回复。</span></div></article>`;
  if (type === "agent_final") {
    const changeSet = buildRunChangeSet(state.events, data.runId);
    const artifactLinks = renderArtifactLinks(changeSet);
    const changeCard = changeSet.files.length ? renderChangeCard(changeSet) : "";
    const summary = projectRunTaskText(data.summary, data.runId);
    return `<article class="event event-final">${meta}<div class="final-message"><div class="markdown-output">${renderMarkdown(summary)}</div>${artifactLinks}</div>${changeCard}</article>`;
  }
  if (type === "agent_error") {
    const presentation = presentAgentError(event);
    return `<article class="event">${meta}<div class="message ${presentation.tone === "error" ? "error-message" : "agent"}" data-tone="${presentation.tone}"><strong>${displayHtml(presentation.title)}</strong><br>${displayHtml(presentation.detail)}</div></article>`;
  }
  if (type.startsWith("tool_")) {
    const detail = data.presentation?.detail ?? data.summary ?? data.input ?? data.detail ?? "";
    const title = data.presentation?.title ?? data.tool;
    const request = (type === "tool_completed" || type === "tool_cancelled") && data.toolCallId
      ? state.events.find((candidate) => candidate.type === "tool_requested" && candidate.data?.toolCallId === data.toolCallId)
      : null;
    const duration = request ? ` · 耗时 ${formatElapsed(request.timestamp, timestamp)}` : "";
    const terminal = type === "tool_completed" || type === "tool_cancelled" ? presentToolCompletion(event) : null;
    const status = terminal ? `${terminal.label}${duration}` : "执行中";
    return `<article class="event">${meta}<div class="tool-card"><div class="tool-card-header"><span class="tool-name">${displayHtml(title)}</span><span>${status}</span></div><div class="tool-detail ${data.input ? "tool-input" : ""}">${displayHtml(detail)}</div></div></article>`;
  }
  return "";
}

const traceEventTypes = new Set(["model_request_started", "model_response_received", "model_stream_started", "model_text_delta", "tool_call_delta", "tool_call_ready", "model_stream_completed", "model_attempt_failed", "model_retry_scheduled", "agent_reasoning", "run_state_changed", "run_budget_warning", "run_budget_exceeded", "context_compacted", "tool_batch_started", "tool_requested", "tool_completed", "tool_cancelled", "tool_batch_completed", "task_progress_changed", "workspace_mutation_observed"]);

// Raw stream/protocol events are persisted for replay, but must not recreate the
// transcript DOM. Claude Code similarly groups and collapses those attachments
// before rendering its normal conversation view.
const visibleUpdateEventTypes = new Set([
  "user_message",
  "session_renamed",
  "agent_reasoning",
  "model_text_delta",
  "tool_batch_started",
  "tool_requested",
  "tool_completed",
  "tool_cancelled",
    "tool_batch_completed",
    "task_progress_changed",
    "workspace_mutation_observed",
  "permission_requested",
  "permission_decision",
  "model_attempt_failed",
  "model_retry_scheduled",
  "run_budget_warning",
  "run_budget_exceeded",
  "file_changes_reverted",
  "agent_final",
  "agent_error",
  "agent_cancelled"
]);

function shouldRenderIncomingEvents(events) {
  return events.some((event) => visibleUpdateEventTypes.has(event.type)
    || (event.type === "run_state_changed" && ["completed", "failed", "cancelled"].includes(event.data?.to)));
}

function isNearTimelineBottom() {
  const { scrollTop, clientHeight, scrollHeight } = elements.scroll;
  return scrollHeight - (scrollTop + clientHeight) < 96;
}

function patchRunTrace(runId) {
  if (!runId) return false;
  const current = elements.timeline.querySelector(`[data-trace-id="${CSS.escape(runId)}"]`);
  if (!current) return false;
  const run = buildRunViewModels(state.events).find((candidate) => candidate.runId === runId);
  const events = state.events.filter((event) => event.data?.runId === runId && traceEventTypes.has(event.type));
  if (!events.length) return false;
  const live = state.running && !run?.isTerminal;
  const template = document.createElement("template");
  template.innerHTML = renderTrace(events, live, run).trim();
  const next = template.content.firstElementChild;
  if (!next) return false;
  current.replaceWith(next);
  return true;
}

function canPatchTraceOnly(events) {
  const runIds = new Set(events.map((event) => event.data?.runId).filter(Boolean));
  return runIds.size === 1 && events.length > 0 && events.every((event) => traceEventTypes.has(event.type));
}

function renderReasoningActivity(event) {
  return `<div class="trace-activity trace-reasoning"><span class="trace-activity-icon" aria-hidden="true">${icon("sparkles")}</span><div><strong>正在分析</strong><span>${escapeHtml(event.data.detail ?? "正在结合当前上下文判断下一步操作。")}</span></div></div>`;
}

function renderReasoningSummary(event, { streaming = false } = {}) {
  const source = event.data?.summary ?? event.data?.text ?? "正在组织下一步的可见执行说明。";
  const status = streaming ? "生成执行说明" : "执行说明";
  return `<section class="trace-analysis ${streaming ? "is-streaming" : ""}"><div class="trace-analysis-head"><span class="trace-activity-icon" aria-hidden="true">${icon("sparkles")}</span><span>${status}</span></div><div class="trace-analysis-body markdown-output">${renderMarkdown(source)}</div></section>`;
}

function renderRetryActivity(event) {
  const presentation = presentModelAttempt(event);
  return `<div class="trace-activity trace-reasoning" data-tone="${presentation.tone}"><span class="trace-activity-icon" aria-hidden="true">${icon("refresh")}</span><div><strong>${escapeHtml(presentation.title)}</strong><span>${displayHtml(presentation.detail)}</span></div></div>`;
}

function renderToolExecution(execution) {
  const { request, completion, operation } = execution;
  const data = completion?.data ?? request.data;
  const presentation = data.presentation ?? request.data.presentation ?? {};
  const title = presentation.title ?? data.tool;
  const detail = presentation.detail ?? data.summary ?? "正在执行";
  const duration = completion ? formatElapsed(request.timestamp, completion.timestamp) : "执行中";
  const terminal = completion ? presentToolCompletion(completion) : null;
  const status = terminal?.label ?? "执行中";
  const output = completion?.data.ok ? completion.data.summary : completion?.data.error?.message;
  const input = JSON.stringify(request.data.input ?? {}, null, 2);
  const result = output ?? "尚未返回结果。";
  if (operation?.kind === "file" && operation.files.length) {
    const file = operation.files[0];
    const verb = operation.presentation?.title ?? title;
    const diff = `<span class="trace-file-diff"><b class="diff-add">+${file.additions}</b><b class="diff-delete">−${file.deletions}</b></span>`;
    return `<details class="trace-tool trace-tool-file"><summary><span class="trace-activity-icon trace-tool-icon" aria-hidden="true">${icon("file")}</span><span class="trace-tool-main"><strong>${displayHtml(verb)}</strong><button type="button" class="trace-file-link" data-trace-file-run="${escapeHtml(operation.runId)}">${displayHtml(file.path)}</button></span>${diff}</summary><div class="trace-tool-detail"><div><span>调用参数</span><pre>${displayHtml(input)}</pre></div><div><span>工具结果</span><pre>${displayHtml(result)}</pre></div></div></details>`;
  }
  if (operation?.kind === "command") {
    const commandTitle = operation.presentation?.title ?? title;
    const commandDuration = Number.isFinite(operation.durationMs) ? formatDuration(operation.durationMs) : duration;
    return `<details class="trace-tool trace-tool-command"><summary><span class="trace-activity-icon trace-tool-icon" aria-hidden="true">${icon("terminal")}</span><span class="trace-tool-main"><strong>${displayHtml(commandTitle)}</strong><span>${displayHtml(operation.command?.text ?? detail)}</span></span><span class="trace-tool-status ${operation.status === "failed" ? "is-error" : ""}" data-tone="${terminal?.tone ?? "active"}">${commandDuration}</span></summary><div class="trace-tool-detail"><div><span>工作目录与命令</span><pre>${displayHtml(`${operation.command?.cwd ?? "."}> ${operation.command?.text ?? ""}`)}</pre></div><div><span>工具结果</span><pre>${displayHtml(result)}</pre></div></div></details>`;
  }
  const operationTitle = operation?.presentation?.title ?? title;
  const operationDetail = operation?.presentation?.detail ?? detail;
  return `<details class="trace-tool"><summary><span class="trace-activity-icon trace-tool-icon" aria-hidden="true">${icon("tool")}</span><span class="trace-tool-main"><strong>${displayHtml(operationTitle)}</strong><span>${displayHtml(operationDetail)}</span></span><span class="trace-tool-status ${terminal?.tone === "error" ? "is-error" : ""}" data-tone="${terminal?.tone ?? "active"}">${status} · ${duration}</span></summary><div class="trace-tool-detail"><div><span>调用参数</span><pre>${displayHtml(input)}</pre></div><div><span>工具结果</span><pre>${displayHtml(result)}</pre></div></div></details>`;
}

function renderToolBatch(batch, live) {
  const executions = batch.executions.filter(({ request }) => !["TaskCreate", "TaskUpdate", "TaskList"].includes(request.data?.tool));
  if (!executions.length) return "";
  const id = batch.batchId;
  const completed = executions.filter(({ completion }) => completion).length;
  const outcomes = executions.map(({ completion }) => completion ? presentToolCompletion(completion) : null);
  const failed = outcomes.filter((outcome) => outcome?.outcome === "failed").length;
  const notRun = outcomes.filter((outcome) => outcome?.outcome === "not_run").length;
  const cancelled = outcomes.filter((outcome) => outcome?.outcome === "cancelled").length;
  const end = batch.endedAt ?? (completed === executions.length ? executions.at(-1).completion.timestamp : Date.now());
  const duration = formatElapsed(batch.startedAt ?? executions[0].request.timestamp, end);
  const open = state.openToolBatches.has(id);
  const status = failed
    ? `${failed} 项执行失败`
    : notRun
      ? `${notRun} 项未执行`
      : cancelled
        ? `${cancelled} 项已取消`
        : completed === executions.length ? "已完成" : `执行中 · ${completed}/${executions.length}`;
  return `<details class="trace-tool-batch ${completed < executions.length ? "is-live" : ""}" data-tool-batch-id="${escapeHtml(id)}" ${open ? "open" : ""}><summary><span class="trace-chevron" aria-hidden="true">${icon("chevron-right")}</span><span class="trace-batch-label">${escapeHtml(batch.label ?? "执行工具")}</span><span class="trace-tool-status ${failed ? "is-error" : ""}">${status} · ${duration}</span></summary><div class="trace-tool-batch-list">${executions.map((execution) => renderToolExecution(execution)).join("")}</div></details>`;
}

function runSummary(run, live) {
  const elapsed = live
    ? `<span data-run-elapsed-start="${escapeHtml(run.startedAt)}">${formatDuration(run.elapsedMs)}</span>`
    : formatDuration(run.elapsedMs);
  return formatRunSummary(run, { live, elapsed });
}

function renderTrace(events, live, run) {
  const traceId = run?.runId ?? events[0].id ?? `${events[0].timestamp}-${events[0].type}`;
  const terminalEvent = [...events].reverse().find((event) => event.type === "run_state_changed" && ["completed", "failed", "cancelled"].includes(event.data?.to));
  const fallbackEnd = terminalEvent?.timestamp ?? (live ? new Date().toISOString() : events.at(-1).timestamp);
  const fallbackRun = run ?? {
    runId: traceId,
    state: terminalEvent?.data?.to ?? "preparing",
    isTerminal: Boolean(terminalEvent),
    startedAt: events[0].timestamp,
    elapsedMs: Math.max(0, new Date(fallbackEnd).getTime() - new Date(events[0].timestamp).getTime()),
    toolResultCount: new Set(events.filter((event) => event.type === "tool_completed" || event.type === "tool_cancelled").map((event) => event.data?.toolCallId ?? event.id)).size,
    analysisCount: events.filter((event) => event.type === "run_state_changed" && event.data?.to === "sampling").length,
    compactCount: 0,
    contextTokens: null,
    turn: null,
    maxTurns: null,
    retries: null,
    maxRetries: null,
    deadlineMs: null,
    remainingMs: null
  };
  const isOpen = live || state.openTraces.has(traceId);
  const activities = [];
  const todo = buildTodoListViewModel(events, { runId: fallbackRun.runId });
  const trace = buildRunTraceViewModel(events, { live, todo });
  for (const activity of trace.activities) {
    if (activity.kind === "reasoning") activities.push(renderReasoningSummary({ data: { summary: activity.text } }, { streaming: activity.streaming }));
    if (activity.kind === "retry") activities.push(renderRetryActivity(activity.event));
    if (activity.kind === "notice") activities.push(`<div class="trace-notice ${activity.event.type === "run_budget_exceeded" ? "is-error" : ""}"><strong>${escapeHtml(formatBudgetNotice(activity.event, { live }))}</strong></div>`);
    if (activity.kind === "compact") activities.push(`<div class="trace-activity trace-compact"><span class="trace-activity-icon" aria-hidden="true">${icon("package")}</span><div><strong>上下文已自动压缩</strong><span>保留任务状态与关键工具结果，释放模型上下文空间</span></div></div>`);
    if (activity.kind === "tool_batch") activities.push(renderToolBatch(activity, live));
  }
  if (!activities.length && !live) return "";
  if (!activities.length) activities.push(renderReasoningActivity({ data: { detail: "正在准备下一步操作。" } }));

  const summary = runSummary(fallbackRun, live);
  return `<details class="run-trace ${live ? "is-live" : ""}" data-trace-id="${escapeHtml(traceId)}" data-trace-live="${live}" ${isOpen ? "open" : ""}><summary><span class="trace-chevron" aria-hidden="true">${icon("chevron-right")}</span><span class="trace-state">${summary.state}</span><span class="trace-meta">${summary.meta}</span></summary><div class="trace-detail">${activities.join("")}</div></details>`;
}

function traceReachedTerminalState(events) {
  return events.some((event) => event.type === "run_state_changed" && ["completed", "failed", "cancelled"].includes(event.data?.to));
}

function renderTimeline() {
  const hiddenTimelineEvents = new Set([
    "session_started",
    "session_renamed",
    "permission_decision",
    "permission_requested",
    "permission_hook",
    "permission_hook_error",
    "context_modifiers_merged",
    "context_budget_evaluated",
    "reactive_recovery_applied",
    "reactive_recovery_failed",
    "reactive_recovery_exhausted",
    "session_snapshot_saved",
    "token_usage_recorded",
    "tool_result_recorded",
    "tool_result_repaired"
  ]);
  const visibleEvents = state.events.filter((event) => !hiddenTimelineEvents.has(event.type));
  const runsById = new Map(buildRunViewModels(state.events).map((run) => [run.runId, run]));
  const chunks = [];
  let trace = [];
  const renderedRunIds = new Set();

  const flushTrace = () => {
    if (!trace.length) return;
    const run = runsById.get(trace[0].data?.runId);
    const live = state.running && !run?.isTerminal && !traceReachedTerminalState(trace);
    chunks.push(renderTrace(trace, live, run));
    trace = [];
  };

  for (const event of visibleEvents) {
    if (traceEventTypes.has(event.type)) {
      const runId = event.data?.runId;
      if (runId) {
        flushTrace();
        if (!renderedRunIds.has(runId)) {
          const run = runsById.get(runId);
          const runEvents = state.events.filter((candidate) => candidate.data?.runId === runId && traceEventTypes.has(candidate.type));
          const live = state.running && !run?.isTerminal;
          chunks.push(renderTrace(runEvents, live, run));
          renderedRunIds.add(runId);
        }
        continue;
      }
      trace.push(event);
      continue;
    }
    flushTrace();
    chunks.push(renderEvent(event));
  }
  flushTrace();
  return chunks.join("");
}

function renderTurnNavigation() {
  const turns = buildConversationTurns(state.events);
  if (turns.length < 4) {
    elements.turnNavigation.hidden = true;
    elements.turnNavigation.replaceChildren();
    return;
  }
  elements.turnNavigation.hidden = false;
  elements.turnNavigation.innerHTML = turns.map((turn, index) => `
    <button class="turn-nav-item ${index === turns.length - 1 ? "is-latest" : ""}" type="button" data-turn-target="${escapeHtml(turn.id)}" aria-label="跳转到第 ${index + 1} 轮对话" aria-describedby="turn-preview-${index}"${index === turns.length - 1 ? ' aria-current="step"' : ""}>
      <span class="turn-nav-line" aria-hidden="true"></span>
      <span class="turn-nav-preview" id="turn-preview-${index}" role="tooltip">
        <span class="turn-nav-preview-section"><strong>你</strong><span>${escapeHtml(turn.user || "（空消息）")}</span></span>
        <span class="turn-nav-preview-section"><strong>CodePilot</strong><span>${escapeHtml(turn.assistant)}</span></span>
      </span>
    </button>`).join("");
}

function anchorContentTop(anchor) {
  const scrollRect = elements.scroll.getBoundingClientRect();
  return elements.scroll.scrollTop + anchor.getBoundingClientRect().top - scrollRect.top;
}

function captureConversationViewport(sessionId = state.session?.id) {
  if (!sessionId || restoringConversationViewport) return;
  const anchors = [...elements.timeline.querySelectorAll("[data-turn-id]")];
  const scrollRect = elements.scroll.getBoundingClientRect();
  let anchor = anchors[0] ?? null;
  for (const candidate of anchors) {
    if (candidate.getBoundingClientRect().top <= scrollRect.top + 1) anchor = candidate;
    else break;
  }
  const contentTop = anchor ? anchorContentTop(anchor) : 0;
  state.conversationViewports = updateConversationViewport(state.conversationViewports, sessionId, {
    anchorId: anchor?.dataset.turnId ?? null,
    anchorOffset: elements.scroll.scrollTop - contentTop,
    scrollTop: elements.scroll.scrollTop,
    updatedAt: Date.now()
  });
  localStorage.setItem(conversationViewportsStorageKey, persistConversationViewports(state.conversationViewports));
}

function restoreConversationViewport(sessionId) {
  const receipt = state.conversationViewports[sessionId];
  restoringConversationViewport = true;
  requestAnimationFrame(() => {
    const anchor = receipt?.anchorId
      ? elements.timeline.querySelector(`[data-turn-id="${CSS.escape(receipt.anchorId)}"]`)
      : null;
    elements.scroll.scrollTop = anchor
      ? anchorContentTop(anchor) + receipt.anchorOffset
      : receipt?.scrollTop ?? elements.scroll.scrollHeight;
    requestAnimationFrame(() => { restoringConversationViewport = false; });
  });
}

function renderTools() {
  const tools = state.events.filter((event) => ["tool_requested", "tool_completed", "tool_cancelled"].includes(event.type));
  const callCount = tools.filter((event) => event.type === "tool_requested").length;
  elements.toolCount.textContent = `${callCount} 次调用`;
  if (!tools.length) {
    elements.toolActivity.innerHTML = "<p class=\"placeholder\">工具事件将在这里显示。</p>";
    return;
  }
  elements.toolActivity.innerHTML = tools.slice(-6).map((event) => {
    const terminal = event.type === "tool_requested" ? null : presentToolCompletion(event);
    const tone = terminal?.tone ?? "active";
    const detail = event.data.presentation?.detail ?? event.data.summary ?? event.data.input ?? event.data.detail ?? "";
    const status = terminal ? ` · ${terminal.label}` : " · 执行中";
    return `<div class="activity-row is-${tone}"><span class="activity-dot"></span><div><div class="activity-title">${escapeHtml(event.data.presentation?.title ?? event.data.tool)}<span class="activity-status">${escapeHtml(status)}</span></div><div>${displayHtml(detail)}</div></div></div>`;
  }).join("");
}

function syncRunAction() {
  const switching = Boolean(state.projectSwitch);
  const stopping = state.running && !elements.input.value.trim();
  elements.input.disabled = state.running || switching;
  elements.send.disabled = switching || (state.running ? !stopping : !elements.input.value.trim());
  elements.send.classList.toggle("is-stop", stopping);
  elements.send.innerHTML = stopping ? icon("square") : icon("arrow-up");
  elements.send.setAttribute("aria-label", stopping ? "停止当前任务" : "执行任务");
  renderProjectNavigation();
}

function renderTranscript() {
  if (!state.session) return;
  elements.transcript.textContent = `当前任务已在本地记录 ${state.events.length} 个追加式事件。`;
  elements.transcriptButton.disabled = false;
  elements.transcriptButton.textContent = `查看 ${state.events.length} 个事件`;
}

function formatTokenCount(value) {
  const tokens = Math.max(0, Number(value) || 0);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(tokens));
}

function latestEvent(type) {
  return [...state.events].reverse().find((event) => event.type === type);
}

function renderUsage() {
  const usageEvents = state.events.filter((event) => event.type === "token_usage_recorded");
  const totals = usageEvents.reduce((sum, event) => {
    const usage = event.data?.usage ?? {};
    sum.inputTokens += Number(usage.inputTokens) || 0;
    sum.outputTokens += Number(usage.outputTokens) || 0;
    sum.cacheReadTokens += Number(usage.cacheReadTokens) || 0;
    sum.cacheWriteTokens += Number(usage.cacheWriteTokens) || 0;
    return sum;
  }, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  const totalTokens = totals.inputTokens + totals.outputTokens;
  const hasUsage = usageEvents.length > 0;

  elements.usageSource.textContent = hasUsage ? "API usage" : "等待 API usage";
  elements.usageTotal.textContent = hasUsage ? formatTokenCount(totalTokens) : "--";
  elements.usageInput.textContent = hasUsage ? formatTokenCount(totals.inputTokens) : "--";
  elements.usageOutput.textContent = hasUsage ? formatTokenCount(totals.outputTokens) : "--";
  elements.usageCacheRead.textContent = hasUsage ? formatTokenCount(totals.cacheReadTokens) : "--";
  elements.usageCacheWrite.textContent = hasUsage ? formatTokenCount(totals.cacheWriteTokens) : "--";

  const budget = latestEvent("context_budget_evaluated")?.data;
  const contextWindowTokens = budget?.contextWindowTokens ?? state.modelConfig?.capabilities?.contextWindowTokens;
  if (!contextWindowTokens) {
    elements.contextUsageValue.textContent = "等待模型配置";
    elements.contextUsage.dataset.tone = "neutral";
    elements.contextMeterFill.style.transform = "scaleX(0)";
    elements.contextUsage.title = "模型窗口会在加载配置或首次请求后确定。";
    return;
  }
  if (!budget || !Number.isFinite(Number(budget.currentInputTokens))) {
    elements.contextUsageValue.textContent = `等待请求 / ${formatTokenCount(contextWindowTokens)}`;
    elements.contextUsage.dataset.tone = "neutral";
    elements.contextMeterFill.style.transform = "scaleX(0)";
    elements.contextUsage.title = "当前模型的最大上下文窗口。发送请求后会显示当前 prompt 的估算占用。";
    return;
  }
  const ratio = Math.min(1, Math.max(0, Number(budget.currentInputTokens) / Number(contextWindowTokens)));
  const tone = ratio >= 0.85 ? "danger" : ratio >= 0.7 ? "warning" : "normal";
  const source = budget.tokenSource === "reconciled_api_usage" ? "已由上一请求 API usage 校准" : "本地估算，等待 API usage 校准";
  elements.contextUsageValue.textContent = `约 ${formatTokenCount(budget.currentInputTokens)} / ${formatTokenCount(contextWindowTokens)}`;
  elements.contextUsage.dataset.tone = tone;
  elements.contextMeterFill.style.transform = `scaleX(${Math.max(0.03, ratio)})`;
  elements.contextUsage.title = `${source}。保留输出与安全缓冲后，可用输入预算为约 ${formatTokenCount(budget.inputTokenBudget)}。`;
}

function skillStatus(skill) {
  if (skill.activeInCurrentSnapshot === true && !skill.enabled) return { label: "下轮禁用", tone: "pending" };
  if (skill.activeInCurrentSnapshot === false && skill.enabled) return { label: "下轮启用", tone: "pending" };
  if (skill.activeInCurrentSnapshot === true) return { label: "本轮生效", tone: "active" };
  if (skill.activeInCurrentSnapshot === null && skill.enabled) return { label: "已启用", tone: "active" };
  return { label: "已禁用", tone: "disabled" };
}

function renderCapabilities() {
  const capability = state.capabilities;
  elements.skillsCount.textContent = capability ? String(capability.skills.length) : "--";
  elements.mcpCount.textContent = capability ? String(capability.mcp.configuredCount) : "--";
  if (!capability) {
    elements.skillsGrid.innerHTML = '<p class="placeholder">正在读取项目技能…</p>';
    elements.skillsResultCount.textContent = "加载中";
    elements.skillsCatalogStatus.textContent = "正在核对技能目录";
    elements.skillDetailLayer.hidden = true;
    renderMcpCatalog();
    return;
  }
  const query = state.skillQuery.trim().toLocaleLowerCase();
  const visibleSkills = capability.skills.filter((skill) => !query || [skill.name, skill.displayName, skill.description, skill.path, skill.source, skill.whenToUse].some((value) => String(value).toLocaleLowerCase().includes(query)));
  const selected = capability.skills.find((skill) => skill.name === state.selectedSkill);
  const diagnosticCount = capability.skillDiagnostics?.length ?? 0;
  elements.skillsCatalogStatus.textContent = diagnosticCount
    ? `发现 ${diagnosticCount} 项目录诊断；有效技能仍可使用`
    : "元数据常驻，完整说明由 Skill 工具按需载入";
  elements.skillsResultCount.textContent = query ? `${visibleSkills.length} / ${capability.skills.length} 项` : `${capability.skills.length} 项`;
  elements.skillsGrid.innerHTML = visibleSkills.map((skill) => {
    const status = skillStatus(skill);
    return `<button class="skill-card ${skill.name === state.selectedSkill ? "is-selected" : ""}" type="button" data-skill-name="${escapeHtml(skill.name)}" aria-pressed="${skill.name === state.selectedSkill}"><span class="skill-card-mark" aria-hidden="true">${icon("diamond")}</span><span class="skill-card-copy"><strong>${escapeHtml(skill.name)}</strong><span>${escapeHtml(skill.description)}</span></span><span class="skill-status is-${status.tone}">${status.label}</span></button>`;
  }).join("") || '<div class="skills-empty"><strong>没有匹配的技能</strong><span>尝试搜索名称、描述或来源文件。</span></div>';
  elements.skillDetailLayer.hidden = !selected;
  elements.skillDetailPanel.innerHTML = selected ? `<div class="skill-detail-head"><div><span class="skill-detail-kicker">SKILL DETAIL</span><strong id="skill-detail-title">${escapeHtml(selected.displayName || selected.name)}</strong></div><button type="button" data-close-skill aria-label="关闭技能详情">${icon("close")}</button></div><p>${escapeHtml(selected.description)}</p>${selected.trust === "untrusted" ? `<div class="skill-trust-warning"><strong>未信任的远程 Skill</strong><span>激活时需要单独批准，脚本资源不会自动执行，工具范围强制收敛为只读安全工具。</span></div>` : ""}${selected.whenToUse ? `<div class="skill-when"><strong>适用场景</strong><span>${escapeHtml(selected.whenToUse)}</span></div>` : ""}<dl><div><dt>调用名称</dt><dd>${escapeHtml(selected.name)}</dd></div><div><dt>来源文件</dt><dd>${displayHtml(selected.path)}</dd></div><div><dt>来源信任</dt><dd>${selected.trust === "untrusted" ? `GitHub · 未信任 · ${escapeHtml(selected.installation?.repository || "")}` : "本地项目 · 可信配置"}</dd></div><div><dt>执行方式</dt><dd>${selected.executionContext === "fork" ? "Fork · 隔离子 Agent" : "Inline · 当前 Agent"}</dd></div><div><dt>允许工具</dt><dd>${escapeHtml((selected.allowedTools || []).join(", ") || (selected.trust === "untrusted" ? "只读安全工具" : "沿用当前权限"))}</dd></div><div><dt>调用参数</dt><dd>${escapeHtml(selected.argumentHint || (selected.argumentNames || []).join(", ") || "无")}</dd></div><div><dt>目录格式</dt><dd>${selected.format === "directory" ? "SKILL.md 标准目录" : "旧版单文件"}</dd></div><div><dt>说明规模</dt><dd>${Number(selected.contentLength || 0).toLocaleString()} 字符${selected.truncated ? "（载入时截断）" : ""}</dd></div><div><dt>生命周期</dt><dd>${escapeHtml(selected.lifecycle?.stage || "discovered")}</dd></div><div><dt>当前状态</dt><dd>${skillStatus(selected).label}</dd></div></dl><div class="skill-detail-note">生命周期：installed → discovered → eligible → advertised → invoked → activated → completed。完整正文只在 activated 后进入上下文；启用和安装变化只影响下一轮能力快照。</div><div class="skill-detail-actions"><button class="skill-uninstall" type="button" data-uninstall-skill="${escapeHtml(selected.name)}">卸载技能</button><button class="skill-toggle" type="button" data-toggle-skill="${escapeHtml(selected.name)}" data-enabled="${selected.enabled}">${selected.enabled ? "下轮起禁用" : "下轮起启用"}</button></div>` : "";
  renderMcpCatalog();
}

const mcpStatusLabels = {
  available: "本轮可用",
  configured: "等待首轮",
  "pending-enable": "下轮启用",
  "pending-disable": "下轮停用",
  failed: "连接失败",
  disconnected: "已断开",
  disabled: "已停用"
};

const nativeMcpIcons = {
  workspace: "folder",
  terminal: "terminal",
  delegation: "agent",
  skills: "skills",
  browser: "browser",
  computer: "computer"
};

const featuredMcpCategories = [
  { id: "developer", title: "开发与设计" },
  { id: "productivity", title: "知识与办公" }
];

function featuredMcpAction(product, authState, isInstalled) {
  if (authState?.status === "pending") {
    return '<span class="mcp-featured-status is-pending" role="status">等待授权…</span>';
  }
  if (authState?.status === "authorized" || isInstalled) {
    return `<button class="mcp-featured-action is-connected" type="button" data-disconnect-mcp="${escapeHtml(product.id)}">已连接 · 断开</button>`;
  }
  const label = authState?.status === "failed" ? "重试连接" : "连接";
  return `<button class="mcp-featured-action is-connectable" type="button" data-connect-mcp="${escapeHtml(product.id)}" data-auth-mode="${escapeHtml(product.authMode)}">${label}</button>`;
}

function latestRunId() {
  const scope = state.running ? state.events.slice(state.runStartEventCount) : state.events;
  return [...scope].reverse().find((event) => event.data?.runId)?.data?.runId;
}

function renderTodoList() {
  const runId = latestRunId();
  const todo = buildTodoListViewModel(state.events, { runId });
  // TodoList is a live-run control anchored to the Composer. Terminal run
  // status already belongs to the timeline, so keeping an interrupted list
  // here duplicates the same fact and makes a finished task look active.
  if (!todo || !state.running) {
    elements.todoList.hidden = true;
    elements.todoList.replaceChildren();
    return;
  }

  const current = todo.activeIndex >= 0 ? todo.activeIndex + 1 : Math.min(todo.completed + 1, todo.total);
  const currentTodo = todo.activeIndex >= 0 ? todo.todos[todo.activeIndex] : todo.todos[Math.max(0, current - 1)];
  const changeSet = todo.changes;
  const hasChanges = changeSet.files.length > 0;
  const isOpen = state.openTodoLists.has(runId);
  const statusCopy = {
    completed: "完成",
    in_progress: "进行中",
    pending: "待处理"
  };
  const summaryTitle = `任务 ${todo.completed}/${todo.total}`;
  const summaryDetail = todo.allCompleted
    ? "全部完成"
    : currentTodo
      ? (currentTodo.status === "in_progress" ? currentTodo.activeForm : currentTodo.content)
      : "等待任务更新";
  elements.todoList.hidden = false;
  elements.todoList.innerHTML = `
    <details data-todo-run-id="${escapeHtml(runId)}" ${isOpen ? "open" : ""}>
      <summary>
        <span class="todo-progress-ring" style="--todo-progress:${todo.total ? todo.completed / todo.total : 0}" aria-hidden="true"></span>
        <span class="todo-summary-copy">
          <strong>${summaryTitle}</strong>
          <span>${escapeHtml(summaryDetail)}</span>
        </span>
        ${hasChanges ? `<span class="todo-diff-summary" aria-label="文件修改：增加 ${changeSet.additions} 行，删除 ${changeSet.deletions} 行"><b class="diff-add">+${changeSet.additions}</b><b class="diff-delete">-${changeSet.deletions}</b></span>` : ""}
        <span class="todo-list-chevron" aria-hidden="true">${icon("chevron-down")}</span>
      </summary>
      <div class="todo-list-body">
        <ol>${todo.todos.map((item, index) => `
          <li data-status="${item.status}">
            <span class="todo-item-index" aria-hidden="true">${String(index + 1).padStart(2, "0")}</span>
            <span class="todo-status-icon" aria-hidden="true">${item.status === "completed" ? icon("check") : ""}</span>
            <span class="todo-item-copy">${escapeHtml(item.status === "in_progress" ? item.activeForm : item.content)}</span>
            <span class="todo-item-state">${statusCopy[item.status] ?? "待处理"}</span>
          </li>`).join("")}
        </ol>
        ${hasChanges ? `<div class="todo-file-summary"><span>${changeSet.reverted ? "文件修改已撤销" : `已修改 ${changeSet.files.length} 个文件`}</span><span><b class="diff-add">+${changeSet.additions}</b><b class="diff-delete">-${changeSet.deletions}</b></span></div>` : ""}
      </div>
    </details>`;
}

function renderFeaturedMcpCatalog() {
  const products = state.capabilities?.mcp?.featuredProducts ?? [];
  const query = state.mcpQuery.trim().toLocaleLowerCase();
  const visible = products.filter((product) => !query || [
    product.title,
    product.description,
    product.publisher,
    product.registryName,
    product.category
  ].some((value) => String(value ?? "").toLocaleLowerCase().includes(query)));
  const installed = new Set((state.capabilities?.mcp?.servers ?? []).map((server) => server.name));
  const authStates = state.capabilities?.mcp?.authStates ?? {};
  elements.mcpFeaturedCount.textContent = query ? `${visible.length} / ${products.length} 项` : `${products.length} 项`;
  elements.mcpFeaturedCatalog.innerHTML = featuredMcpCategories.map((category) => {
    const items = visible.filter((product) => product.category === category.id);
    if (!items.length) return "";
    return `<section class="mcp-featured-group"><h3>${escapeHtml(category.title)}</h3><div class="mcp-featured-grid">${items.map((product) => {
      const isInstalled = installed.has(product.serverName);
      const provenance = product.provenance === "official" ? "官方" : product.provenance === "community" ? "社区" : "生态候选";
      const authState = authStates[product.id];
      const authLabel = `${product.authMode === "oauth" ? "OAuth 2.1" : "加密 Token"} · ${authState?.status === "authorized" || isInstalled ? "凭据已就绪" : "按需连接"}`;
      return `<article class="mcp-featured-card"><span class="mcp-brand-icon" aria-hidden="true">${icon("mcp")}</span><div class="mcp-featured-copy"><div><strong>${escapeHtml(product.title)}</strong><span class="mcp-provenance is-${escapeHtml(product.provenance)}">${escapeHtml(provenance)}</span></div><p>${escapeHtml(product.description)}</p><small>${escapeHtml(authLabel || product.publisher)}</small></div>${featuredMcpAction(product, authState, isInstalled)}</article>`;
    }).join("")}</div></section>`;
  }).join("") || '<div class="skills-empty"><strong>精选连接中没有匹配项</strong><span>下方 Registry 全部仍会继续查询更多公共服务。</span></div>';
}

function renderMcpMarketplace() {
  const registry = state.mcpRegistry;
  if (registry.loading) {
    elements.mcpRegistryStatus.textContent = "正在查询官方 MCP Registry…";
    elements.mcpMarketplaceGrid.innerHTML = '<p class="placeholder">正在载入公共 MCP 服务…</p>';
    return;
  }
  if (registry.error) {
    elements.mcpRegistryStatus.textContent = `公共目录暂时未载入 · ${registry.error}`;
    elements.mcpMarketplaceGrid.innerHTML = '<div class="skills-empty"><strong>官方目录连接失败</strong><span>已安装和内置能力保持可用。检查网络后点击“重新加载”。</span></div>';
    return;
  }
  if (!registry.loaded) {
    elements.mcpRegistryStatus.textContent = "打开页面后从官方 MCP Registry 查询，不使用内置推荐假数据";
    elements.mcpMarketplaceGrid.innerHTML = '<p class="placeholder">等待载入公共 MCP 服务…</p>';
    return;
  }
  const installed = new Set((state.capabilities?.mcp?.servers ?? []).map((server) => server.name));
  elements.mcpRegistryStatus.textContent = `${registry.servers.length} 项结果 · 官方 Registry 预览接口`;
  elements.mcpMarketplaceGrid.innerHTML = registry.servers.map((server) => {
    const isInstalled = installed.has(server.name);
    const reason = server.requiresConfiguration
      ? `需要先提供 ${server.requiredInputCount} 项配置`
      : server.installKind === "remote"
        ? "远程 Streamable HTTP"
        : server.installKind === "npm"
          ? "本地 stdio · npm"
          : "当前传输方式尚未接入";
    const action = isInstalled
      ? '<span class="mcp-install-status">已安装</span>'
      : server.installable
        ? `<button class="mcp-install-button" type="button" data-install-mcp="${escapeHtml(server.name)}" data-version="${escapeHtml(server.version)}">安装</button>`
        : `<span class="mcp-install-status">${server.requiresConfiguration ? "需配置" : "当前传输未接入"}</span>`;
    return `<article class="mcp-marketplace-card"><span class="mcp-marketplace-mark" aria-hidden="true">${icon("mcp")}</span><div class="mcp-marketplace-copy"><strong>${escapeHtml(server.title)}</strong><span>${escapeHtml(server.description)}</span><small>${escapeHtml(`${server.version} · ${reason}`)}</small></div>${action}</article>`;
  }).join("") || '<div class="skills-empty"><strong>没有匹配的公共 MCP</strong><span>尝试服务名称、用途或发布者关键词。</span></div>';
}

function renderMcpCatalog() {
  const mcp = state.capabilities?.mcp;
  if (!mcp) {
    elements.mcpConfiguredCount.textContent = "—";
    elements.mcpAvailableCount.textContent = "—";
    elements.mcpToolCount.textContent = "—";
    elements.mcpResultCount.textContent = "加载中";
    elements.mcpCatalogStatus.textContent = "正在核对 .codepilot/mcp.json";
    elements.mcpNativeGrid.innerHTML = '<p class="placeholder">正在读取内置能力…</p>';
    elements.mcpGrid.innerHTML = '<p class="placeholder">正在读取 MCP 服务…</p>';
    elements.mcpFeaturedCatalog.innerHTML = '<p class="placeholder">正在读取精选连接…</p>';
    renderMcpMarketplace();
    return;
  }
  elements.mcpConfiguredCount.textContent = String(mcp.configuredCount);
  elements.mcpAvailableCount.textContent = String(mcp.availableCount);
  elements.mcpToolCount.textContent = String(mcp.toolCount);
  elements.mcpResultCount.textContent = `${mcp.servers.length} 项`;
  elements.mcpCatalogStatus.textContent = mcp.diagnostics.length
    ? `发现 ${mcp.diagnostics.length} 项配置诊断；有效服务仍会进入下一轮`
    : mcp.snapshotId
      ? `最近快照 ${mcp.snapshotId} · 第 ${mcp.snapshotTurn} 轮`
      : "尚未生成会话能力快照";
  elements.mcpNativeGrid.innerHTML = (mcp.nativeCapabilities ?? []).map((capability) => `<article class="mcp-native-card"><span aria-hidden="true">${icon(nativeMcpIcons[capability.id] ?? "mcp")}</span><div><strong>${escapeHtml(capability.title)}</strong><p>${escapeHtml(capability.description)}</p><small>${capability.tools?.length ?? 0} 个原生工具 · 随应用提供</small></div><span class="mcp-native-badge">内置</span></article>`).join("");
  elements.mcpGrid.innerHTML = mcp.servers.map((server) => {
    const endpoint = server.command || server.remoteHost || server.transport;
    const counts = `${server.toolCount} 个工具 · ${server.transport} · ${endpoint}`;
    const lifecycle = server.activeInCurrentSnapshot && server.status === "pending-disable" ? "当前快照仍保留；下一轮移除" : server.status === "pending-enable" ? "配置已保存；下一轮重新冻结能力" : `${server.source === "official" ? "官方 Registry" : "项目配置"}${server.version ? ` · ${server.version}` : ""}`;
    return `<article class="mcp-server-card"><span class="mcp-server-icon" aria-hidden="true">${icon("mcp")}</span><div class="mcp-server-copy"><strong>${escapeHtml(server.title || server.name)}</strong><span>${escapeHtml(counts)}</span><small>${escapeHtml(lifecycle)}</small></div><div class="mcp-server-meta"><span class="mcp-status is-${escapeHtml(server.status)}">${escapeHtml(mcpStatusLabels[server.status] ?? server.status)}</span><div class="mcp-server-actions"><button class="mcp-action-button" type="button" data-toggle-mcp="${escapeHtml(server.name)}" data-enabled="${server.enabled}">${server.enabled ? "停用" : "启用"}</button><button class="mcp-action-button is-danger" type="button" data-uninstall-mcp="${escapeHtml(server.name)}">卸载</button></div></div></article>`;
  }).join("") || '<div class="mcp-empty-row"><span aria-hidden="true">' + icon("mcp") + '</span><div><strong>尚未安装公共 MCP</strong><small>从精选连接开始，或在 Registry 全部中安装无需额外配置的服务。</small></div></div>';
  renderFeaturedMcpCatalog();
  renderMcpMarketplace();
}

async function loadMcpRegistry({ force = false } = {}) {
  if (state.mcpRegistry.loading || (state.mcpRegistry.loaded && !force)) return;
  state.mcpRegistry = { ...state.mcpRegistry, loading: true, error: null };
  renderMcpMarketplace();
  try {
    const query = state.mcpQuery.trim();
    const result = await api(`/api/mcp/registry?limit=24${query ? `&query=${encodeURIComponent(query)}` : ""}`);
    state.mcpRegistry = { ...state.mcpRegistry, ...result, loading: false, loaded: true, error: null };
  } catch (error) {
    console.error(error);
    state.mcpRegistry = { ...state.mcpRegistry, loading: false, loaded: true, error: error.message || "连接失败" };
  }
  renderMcpMarketplace();
}

function closeSkillDetail({ restoreFocus = true } = {}) {
  state.selectedSkill = null;
  elements.skillDetailLayer.hidden = true;
  elements.skillDetailPanel.innerHTML = "";
  if (restoreFocus) skillDetailReturnFocus?.focus?.();
  skillDetailReturnFocus = null;
  renderCapabilities();
}

async function loadCapabilities({ loadEpoch = null } = {}) {
  const query = state.session ? `?sessionId=${encodeURIComponent(state.session.id)}` : "";
  const capabilities = await api(`/api/capabilities${query}`);
  if (loadEpoch !== null && loadEpoch !== sessionLoadEpoch) return;
  state.capabilities = capabilities;
  if (state.selectedSkill && !state.capabilities.skills.some((skill) => skill.name === state.selectedSkill)) state.selectedSkill = null;
  renderCapabilities();
}

function closeMcpTokenDialog() {
  elements.mcpTokenInput.value = "";
  elements.mcpTokenError.hidden = true;
  elements.mcpTokenError.textContent = "";
  state.mcpTokenProductId = null;
  if (elements.mcpTokenDialog.open) elements.mcpTokenDialog.close();
}

function openMcpTokenDialog(productId) {
  const product = state.capabilities?.mcp?.featuredProducts?.find((item) => item.id === productId);
  state.mcpTokenProductId = productId;
  elements.mcpTokenTitle.textContent = `连接 ${product?.title ?? "MCP"}`;
  elements.mcpTokenError.hidden = true;
  elements.mcpTokenDialog.showModal();
  requestAnimationFrame(() => elements.mcpTokenInput.focus());
}

function stopMcpAuthPolling(productId) {
  const timer = state.mcpAuthPollers.get(productId);
  if (timer) clearTimeout(timer);
  state.mcpAuthPollers.delete(productId);
}

function pollMcpAuth(productId) {
  stopMcpAuthPolling(productId);
  const check = async () => {
    try {
      const session = state.session ? `&sessionId=${encodeURIComponent(state.session.id)}` : "";
      const result = await api(`/api/mcp/auth/status?productId=${encodeURIComponent(productId)}${session}`);
      if (result.capabilities) state.capabilities = result.capabilities;
      else if (state.capabilities?.mcp?.authStates) state.capabilities.mcp.authStates[productId] = result.state;
      renderCapabilities();
      if (result.state.status === "authorized") {
        stopMcpAuthPolling(productId);
        showRuntimeNotice("MCP 已连接；将在下一轮能力快照中生效。");
        return;
      }
      if (result.state.status === "failed" || result.state.status === "needs-auth") {
        stopMcpAuthPolling(productId);
        if (result.state.status === "failed") showRuntimeNotice(result.state.message || "MCP 授权失败，请重试。");
        return;
      }
    } catch (error) {
      console.error(error);
    }
    state.mcpAuthPollers.set(productId, setTimeout(check, 1000));
  };
  void check();
}

function openSkillsView() {
  if (!elements.mcpLayer.hidden) {
    elements.mcpLayer.hidden = true;
    document.querySelectorAll("[aria-controls='mcp-layer']").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }
  dialogReturnFocus = document.activeElement;
  state.primaryNavigation = setPrimaryView(state.primaryNavigation, "skills");
  elements.skillsLayer.hidden = false;
  document.querySelectorAll("[aria-controls='skills-layer']").forEach((button) => button.setAttribute("aria-expanded", "true"));
  renderPrimaryNavigation();
  renderCapabilities();
  requestAnimationFrame(() => elements.skillsSearch.focus());
}

function closeSkillsView() {
  closeSkillDetail({ restoreFocus: false });
  state.primaryNavigation = setPrimaryView(state.primaryNavigation, "conversation");
  elements.skillsLayer.hidden = true;
  document.querySelectorAll("[aria-controls='skills-layer']").forEach((button) => button.setAttribute("aria-expanded", "false"));
  renderPrimaryNavigation();
  dialogReturnFocus?.focus?.();
  dialogReturnFocus = null;
}

function openMcpView() {
  if (!elements.skillsLayer.hidden) {
    closeSkillDetail({ restoreFocus: false });
    elements.skillsLayer.hidden = true;
    document.querySelectorAll("[aria-controls='skills-layer']").forEach((button) => button.setAttribute("aria-expanded", "false"));
  }
  dialogReturnFocus = document.activeElement;
  state.primaryNavigation = setPrimaryView(state.primaryNavigation, "mcp");
  elements.mcpLayer.hidden = false;
  document.querySelectorAll("[aria-controls='mcp-layer']").forEach((button) => button.setAttribute("aria-expanded", "true"));
  renderPrimaryNavigation();
  renderMcpCatalog();
  void loadMcpRegistry();
  requestAnimationFrame(() => elements.mcpSearch.focus());
}

function closeMcpView() {
  state.primaryNavigation = setPrimaryView(state.primaryNavigation, "conversation");
  elements.mcpLayer.hidden = true;
  document.querySelectorAll("[aria-controls='mcp-layer']").forEach((button) => button.setAttribute("aria-expanded", "false"));
  renderPrimaryNavigation();
  dialogReturnFocus?.focus?.();
  dialogReturnFocus = null;
}

function closePrimaryCapabilityView() {
  if (!elements.skillsLayer.hidden) closeSkillsView();
  else if (!elements.mcpLayer.hidden) closeMcpView();
}

function showPermission(event) {
  state.pendingPermission = event;
  const data = event.data;
  const preview = data.diff ?? data.command ?? "暂无可展示的变更预览。";
  const matcher = Object.entries(data.matcher ?? {})
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(" | ") : value}`)
    .join(" · ");
  elements.permission.hidden = false;
  elements.permission.innerHTML = `
    <section class="permission-dialog permission-request-dialog" role="dialog" aria-modal="true" aria-labelledby="permission-title" aria-describedby="permission-summary">
      <header class="permission-head permission-request-head">
        <span class="permission-request-icon" aria-hidden="true">${icon("shield-check")}</span>
        <div class="permission-request-title">
          <div class="permission-tool">PERMISSION REQUEST · ${escapeHtml(data.tool)}</div>
          <h2 id="permission-title">允许 CodePilot 执行此操作？</h2>
        </div>
        <span class="permission-scope">${escapeHtml(data.file ?? "当前工作区")}</span>
      </header>
      <div class="permission-body permission-request-body">
        <section class="permission-copy-section">
          <span class="permission-section-label">为什么需要</span>
          <p id="permission-summary">${displayHtml(data.summary)}</p>
        </section>
        ${matcher ? `<section class="permission-copy-section"><span class="permission-section-label">授权范围</span><p class="permission-matcher">${escapeHtml(matcher)}</p></section>` : ""}
        <section class="permission-copy-section permission-evidence-section">
          <div class="permission-evidence-head"><span class="permission-section-label">操作证据</span><span>${escapeHtml(data.command ? "COMMAND" : data.diff ? "DIFF" : "DETAIL")}</span></div>
          <pre class="diff-preview">${escapeHtml(preview)}</pre>
        </section>
        <p class="permission-session-note"><span aria-hidden="true">${icon("info")}</span>本次批准只处理当前请求；后续同类操作仍由 Permission Engine 重新判断。</p>
      </div>
      <footer class="permission-actions permission-request-actions">
        <span class="permission-shortcut"><kbd>ESC</kbd> 保持等待</span>
        <div>
          <button class="deny-button" type="button" data-approval="deny_task">拒绝</button>
          <button class="allow-button" type="button" data-approval="allow_once">仅本次批准</button>
        </div>
      </footer>
    </section>`;
}

function hidePermission() {
  elements.permission.hidden = true;
  elements.permission.innerHTML = "";
  state.pendingPermission = null;
}

function eventLogPreview(event) {
  if (event.type === "model_attempt_failed" || event.type === "model_retry_scheduled") return presentModelAttempt(event).detail;
  if (event.type === "agent_error") return presentAgentError(event).detail;
  if (event.type === "run_state_changed") return `${presentRunState(event.data).label} · ${event.data.detail ?? ""}`;
  if (event.type === "tool_completed" || event.type === "tool_cancelled") {
    const presentation = presentToolCompletion(event);
    const detail = event.data.presentation?.detail ?? event.data.summary ?? event.data.tool ?? "";
    return `${presentation.label} · ${detail}`;
  }
  if (event.type === "model_text_delta") return event.data.text ?? "";
  if (event.type === "tool_call_delta") return `${event.data.nameFragment ?? ""}${event.data.argumentsFragment ?? ""}` || "正在接收工具参数";
  if (event.type === "agent_reasoning" || event.type === "agent_final") return event.data.summary ?? "";
  if (event.type.startsWith("tool_")) return event.data.presentation?.detail ?? event.data.summary ?? event.data.tool ?? "";
  return event.data.detail ?? event.data.message ?? event.data.tool ?? "";
}

function isSameToolCallStream(left, right) {
  return left?.type === "tool_call_delta"
    && right?.type === "tool_call_delta"
    && left.data?.streamId === right.data?.streamId
    && left.data?.turn === right.data?.turn
    && left.data?.index === right.data?.index
    && left.data?.toolCallId === right.data?.toolCallId;
}

function buildEventLogEntries(events) {
  const entries = [];
  for (let cursor = 0; cursor < events.length; cursor += 1) {
    const event = events[cursor];
    if (event.type !== "tool_call_delta") {
      entries.push({ kind: "event", event, start: cursor, end: cursor });
      continue;
    }

    const group = [event];
    while (isSameToolCallStream(group[group.length - 1], events[cursor + 1])) {
      group.push(events[++cursor]);
    }
    entries.push({ kind: "tool_call_stream", events: group, start: cursor - group.length + 1, end: cursor });
  }
  return entries;
}

function renderToolCallStreamEntry(entry) {
  const first = entry.events[0];
  const name = entry.events.map((event) => event.data?.nameFragment ?? "").join("") || "未命名工具";
  const argumentsText = entry.events.map((event) => event.data?.argumentsFragment ?? "").join("");
  const completeArguments = argumentsText || "（本次没有参数）";
  const index = entry.start === entry.end ? entry.start + 1 : `${entry.start + 1}-${entry.end + 1}`;
  const rawEvents = entry.events.map((event, offset) => ({ eventNumber: entry.start + offset + 1, ...event }));
  return `<details class="event-log-row event-log-stream" data-tone="success"><summary><span class="event-log-index">${index}</span><span class="event-log-status-dot" aria-hidden="true"></span><span class="event-log-type">工具参数流 · ${escapeHtml(name)}</span><span class="event-log-preview">已拼接完成：${escapeHtml(completeArguments)}</span><time>${eventTime(first.timestamp)}</time><span class="event-log-chevron" aria-hidden="true">${icon("chevron-right")}</span></summary><div class="event-log-stream-meta">${entry.events.length} 个片段 · 原始事件仅在展开后显示</div><pre>${escapeHtml(JSON.stringify(rawEvents, null, 2))}</pre></details>`;
}

function eventLogTone(event) {
  if (event.type.includes("failed") || event.type === "agent_error") return "danger";
  if (event.type.includes("cancelled") || event.type.includes("orphaned")) return "muted";
  if (event.type.includes("completed") || event.type === "agent_final" || event.type === "task_progress_changed") return "success";
  if (event.type.startsWith("model_") || event.type.startsWith("tool_") || event.type === "run_state_changed") return "accent";
  return "neutral";
}

function renderEventLogEntry(entry) {
  if (entry.kind === "tool_call_stream") return renderToolCallStreamEntry(entry);
  const { event } = entry;
  return `<details class="event-log-row" data-tone="${eventLogTone(event)}"><summary><span class="event-log-index">${String(entry.start + 1).padStart(3, "0")}</span><span class="event-log-status-dot" aria-hidden="true"></span><span class="event-log-type">${escapeHtml(eventLabel(event))}</span><span class="event-log-preview">${escapeHtml(eventLogPreview(event))}</span><time>${eventTime(event.timestamp)}</time><span class="event-log-chevron" aria-hidden="true">${icon("chevron-right")}</span></summary><pre>${escapeHtml(JSON.stringify(event, null, 2))}</pre></details>`;
}

function showEventLog() {
  dialogReturnFocus = document.activeElement;
  const entries = buildEventLogEntries(state.events);
  const rows = entries.map(renderEventLogEntry).join("");
  elements.eventLog.hidden = false;
  elements.eventLog.innerHTML = `
    <section class="event-log-dialog" role="dialog" aria-modal="true" aria-labelledby="event-log-title">
      <header class="permission-head event-log-head">
        <span class="event-log-head-icon" aria-hidden="true">${icon("history")}</span>
        <div><div class="permission-tool">SESSION EVENT LOG</div><h2 id="event-log-title">会话事件回放</h2></div>
        <span class="event-log-count">${state.events.length} 原始事件</span>
        <button class="close-button" type="button" data-close-event-log aria-label="关闭事件回放">${icon("close")}</button>
      </header>
      <div class="event-log-summary"><span aria-hidden="true">${icon("info")}</span><p>回放视图合并为 <strong>${entries.length}</strong> 条。连续工具参数流已折叠；展开单行可查看原始 JSONL。</p><span class="event-log-ready">PROJECTOR · READY</span></div>
      <div class="event-log-columns" aria-hidden="true"><span>#</span><span>事件</span><span>语义摘要</span><span>时间</span><span></span></div>
      <div class="event-log-list">${rows || "<p class=\"placeholder\">当前没有事件。</p>"}</div>
      <footer class="event-log-footer"><span>选择任一事件查看原始 payload</span><span>JSONL · APPEND ONLY</span></footer>
      <span class="event-log-resize-hint" aria-hidden="true"></span>
    </section>`;
  requestAnimationFrame(() => elements.eventLog.querySelector("[data-close-event-log]")?.focus());
}

function hideEventLog() {
  elements.eventLog.hidden = true;
  elements.eventLog.innerHTML = "";
  dialogReturnFocus?.focus?.();
  dialogReturnFocus = null;
}

function render({ scrollToLatest = true } = {}) {
  const renameEvent = [...state.events].reverse().find((event) => event.type === "session_renamed" && event.data?.title);
  if (renameEvent && state.session) state.session.title = renameEvent.data.title;
  elements.title.textContent = displayTaskTitle(state.session?.title);
  renderProjectNavigation();
  elements.empty.hidden = state.events.length > 1;
  elements.timeline.innerHTML = renderTimeline();
  renderTurnNavigation();
  renderTodoList();
  renderTools();
  renderTranscript();
  renderUsage();
  const pending = [...state.events].reverse().find((event) => event.type === "permission_requested");
  const decisionsAfterPending = pending && state.events.some((event) => event.type === "permission_decision"
    && event.data?.runId === pending.data?.runId
    && new Date(event.timestamp) > new Date(pending.timestamp));
  const pendingRun = pending?.data?.runId
    ? buildRunViewModels(state.events).find((run) => run.runId === pending.data.runId)
    : null;
  // A permission request is actionable only while its own run is alive. When
  // startup recovery writes supervisor_run_orphaned, the old request remains
  // in JSONL for audit but must not reopen a modal over the new conversation.
  const requestRunIsLive = pendingRun ? !pendingRun.isTerminal : false;
  if (pending && !decisionsAfterPending && requestRunIsLive && !state.pendingPermission) showPermission(pending);
  if ((!pending || decisionsAfterPending || !requestRunIsLive) && state.pendingPermission) hidePermission();
  if (scrollToLatest) elements.scroll.scrollTop = elements.scroll.scrollHeight;
}

function startElapsedClock() {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  state.elapsedTimer = setInterval(() => {
    if (!state.running) return stopElapsedClock();
    updateElapsedTimers();
  }, 1_000);
}

function updateElapsedTimers() {
  document.querySelectorAll("[data-elapsed-start]").forEach((node) => {
    const elapsed = Math.max(0, Math.floor((Date.now() - new Date(node.dataset.elapsedStart).getTime()) / 1_000));
    node.textContent = String(elapsed);
  });
  document.querySelectorAll("[data-run-elapsed-start]").forEach((node) => {
    node.textContent = formatDuration(Math.max(0, Date.now() - new Date(node.dataset.runElapsedStart).getTime()));
  });
  document.querySelectorAll("[data-run-deadline-start]").forEach((node) => {
    const elapsed = Date.now() - new Date(node.dataset.runDeadlineStart).getTime();
    node.textContent = formatDuration(Math.max(0, Number(node.dataset.runDeadlineMs) - elapsed));
  });
}

function stopElapsedClock() {
  if (state.elapsedTimer) clearInterval(state.elapsedTimer);
  state.elapsedTimer = null;
}

function startHeartbeat() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = setInterval(() => {
    if (!state.running || !state.session) return stopHeartbeat();
    api(`/api/sessions/${state.session.id}/heartbeat`, { method: "POST", body: "{}" }).catch(() => {});
  }, 4_000);
}

function stopHeartbeat() {
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
}

function showRuntimeNotice(message, { durationMs = 5_000 } = {}) {
  if (!elements.runtimeNotice) return;
  if (runtimeNoticeTimer) clearTimeout(runtimeNoticeTimer);
  runtimeNoticeTimer = null;
  const text = document.createElement("span");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.setAttribute("aria-label", "关闭提示");
  close.innerHTML = icon("close");
  close.addEventListener("click", hideRuntimeNotice, { once: true });
  elements.runtimeNotice.replaceChildren(text, close);
  elements.runtimeNotice.hidden = false;
  if (durationMs > 0) runtimeNoticeTimer = setTimeout(hideRuntimeNotice, durationMs);
}

function hideRuntimeNotice() {
  if (runtimeNoticeTimer) clearTimeout(runtimeNoticeTimer);
  runtimeNoticeTimer = null;
  if (!elements.runtimeNotice) return;
  elements.runtimeNotice.hidden = true;
  elements.runtimeNotice.replaceChildren();
}

function resizeTaskInput() {
  const shouldStayAtBottom = isNearTimelineBottom();
  const maxHeight = Math.max(96, Math.min(240, Math.floor(window.innerHeight * 0.28)));
  elements.input.style.height = "auto";
  const nextHeight = Math.min(elements.input.scrollHeight, maxHeight);
  elements.input.style.height = `${nextHeight}px`;
  elements.input.style.overflowY = elements.input.scrollHeight > maxHeight ? "auto" : "hidden";
  if (shouldStayAtBottom) {
    requestAnimationFrame(() => {
      elements.scroll.scrollTop = elements.scroll.scrollHeight;
    });
  }
}

const permissionModeCopy = {
  ask: "请求批准",
  auto: "替我批准",
  full: "完全访问工作区"
};

function syncPermissionMode() {
  const mode = state.permissionMode;
  elements.permissionModeLabel.textContent = permissionModeCopy[state.permissionMode] ?? permissionModeCopy.ask;
  elements.permissionModeTrigger.dataset.mode = mode;
  const icons = {
    ask: icon("circle-help"),
    auto: icon("shield-alert"),
    full: icon("shield-check")
  };
  elements.permissionModeIcon.innerHTML = icons[mode] ?? icons.ask;
  elements.permissionModeMenu.querySelectorAll("[data-permission-mode]").forEach((button) => {
    const selected = button.dataset.permissionMode === state.permissionMode;
    button.setAttribute("aria-checked", String(selected));
  });
}

function renderAttachments() {
  const inputCapabilities = state.modelConfig?.capabilities?.input ?? { text: true, image: false, pdf: false };
  elements.attachmentList.innerHTML = state.attachments.map((attachment, index) => {
    const fileType = attachment.kind === "image" ? "IMAGE" : attachment.kind === "pdf" ? "PDF" : attachment.name.includes(".") ? attachment.name.split(".").pop().toUpperCase() : "TEXT";
    const native = attachment.kind === "text" || inputCapabilities[attachment.kind] === true;
    const delivery = attachment.kind === "text" ? "文本投影" : native ? "原生发送" : "仅记录信息";
    return `<div class="attachment-chip" data-delivery="${native ? "content" : "metadata"}" title="${escapeHtml(`${attachment.name} · ${delivery}`)}"><span class="attachment-file-icon" aria-hidden="true">${icon("file-text")}</span><span class="attachment-copy"><strong>${escapeHtml(attachment.name)}</strong><small>${escapeHtml(`${fileType} · ${delivery}`)}</small></span><button type="button" data-remove-attachment="${index}" aria-label="移除 ${escapeHtml(attachment.name)}">${icon("close")}</button></div>`;
  }).join("");
}

function setFileDropActive(active) {
  elements.fileDropOverlay.hidden = !active;
  elements.fileDropOverlay.setAttribute("aria-hidden", String(!active));
}

function isFileDrag(event) {
  return Boolean(event.dataTransfer?.types?.includes("Files"));
}

async function addAttachments(fileList) {
  const remaining = Math.max(0, 4 - state.attachments.length);
  const files = [...fileList].slice(0, remaining);
  if (!files.length) {
    showRuntimeNotice("最多只能添加 4 个附件。");
    return;
  }
  try {
    const loaded = await Promise.all(files.map(async (file) => {
      const mediaType = file.type || inferAttachmentMediaType(file.name);
      const kind = attachmentKind(mediaType);
      if (!kind) throw new Error(`${file.name} 不支持：可上传文本、图片或 PDF`);
      if (kind === "text") {
        const text = await file.text();
        if (text.length > 200_000) throw new Error(`${file.name} 超过 200,000 字符限制`);
        if (text.includes("\u0000")) throw new Error(`${file.name} 不是可读取的文本文件`);
        return { name: file.name, kind, content: text, mediaType };
      }
      const byteLimit = kind === "pdf" ? 4_000_000 : 2_000_000;
      if (file.size > byteLimit) throw new Error(`${file.name} 超过 ${kind === "pdf" ? "4 MB" : "2 MB"} 限制`);
      return { name: file.name, kind, data: await fileAsBase64(file), mediaType, byteSize: file.size };
    }));
    const totalBytes = [...state.attachments, ...loaded].reduce((total, attachment) => total + (attachment.byteSize ?? new Blob([attachment.content ?? ""]).size), 0);
    if (totalBytes > 6_000_000) throw new Error("附件总大小不能超过 6 MB");
    state.attachments.push(...loaded);
    renderAttachments();
  } catch (error) {
    showRuntimeNotice(error instanceof Error ? error.message : "附件读取失败");
  }
}

function inferAttachmentMediaType(name = "") {
  const extension = name.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return "application/pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) return `image/${extension === "jpg" ? "jpeg" : extension}`;
  if (extension === "json") return "application/json";
  return "text/plain";
}

function attachmentKind(mediaType = "") {
  if (["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mediaType)) return "image";
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType.startsWith("text/") || ["application/json", "application/javascript"].includes(mediaType)) return "text";
  return null;
}

function fileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} 读取失败`));
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function closeComposerPopovers() {
  elements.permissionModeMenu.hidden = true;
  elements.workspaceTargetMenu.hidden = true;
  elements.quickModelMenu.hidden = true;
  elements.quickModelOptions.hidden = true;
  elements.quickReasoningOptions.hidden = true;
  elements.permissionModeTrigger.setAttribute("aria-expanded", "false");
  elements.workspaceTargetTrigger.setAttribute("aria-expanded", "false");
  elements.quickModelTrigger.setAttribute("aria-expanded", "false");
  elements.quickModelSelect.setAttribute("aria-expanded", "false");
  elements.quickReasoningSelect.setAttribute("aria-expanded", "false");
}

function renderQuickSelect(trigger, optionsElement, values, selectedValue, labelForValue = (value) => value) {
  const selected = values.includes(selectedValue) ? selectedValue : values[0];
  trigger.dataset.value = selected ?? "";
  trigger.innerHTML = `<span>${escapeHtml(labelForValue(selected ?? ""))}</span>${icon("chevron-down")}`;
  optionsElement.innerHTML = values.map((value) => `<button type="button" role="option" data-quick-value="${escapeHtml(value)}" aria-selected="${String(value === selected)}">${escapeHtml(labelForValue(value))}</button>`).join("");
}

function reasoningEffortLabel(effort) {
  return ({ low: "低", medium: "中", high: "高", xhigh: "超高", max: "最大" })[effort] ?? effort;
}

function toggleQuickSelect(trigger, optionsElement, siblingOptionsElement) {
  const opening = optionsElement.hidden;
  if (siblingOptionsElement) siblingOptionsElement.hidden = true;
  optionsElement.hidden = !opening;
  trigger.setAttribute("aria-expanded", String(opening));
  if (siblingOptionsElement) siblingOptionsElement.previousElementSibling?.setAttribute("aria-expanded", "false");
}

function positionComposerPopover(popover, trigger, align = "left") {
  // Fixed positioning escapes the clipped conversation grid. Measure only after
  // revealing the menu, then keep it wholly inside the visible viewport.
  const triggerRect = trigger.getBoundingClientRect();
  const popoverRect = popover.getBoundingClientRect();
  const preferredLeft = align === "right" ? triggerRect.right - popoverRect.width : triggerRect.left;
  const left = Math.max(12, Math.min(preferredLeft, window.innerWidth - popoverRect.width - 12));
  const preferredTop = triggerRect.top - popoverRect.height - 8;
  const top = preferredTop >= 12 ? preferredTop : Math.min(window.innerHeight - popoverRect.height - 12, triggerRect.bottom + 8);
  popover.style.left = `${Math.max(12, left)}px`;
  popover.style.top = `${Math.max(12, top)}px`;
}

function renderQuickModelSettings() {
  const config = state.modelConfig;
  if (!config) return;
  const catalog = state.providerCatalog[config.provider];
  const models = catalog?.models?.length ? catalog.models : [config.model || "fake-text-model"];
  const selectedModel = models.includes(config.model) ? config.model : models[0];
  renderQuickSelect(elements.quickModelSelect, elements.quickModelOptions, models, selectedModel);
  const modelProfile = catalog?.modelProfiles?.[selectedModel];
  const reasoning = modelProfile?.reasoning ?? catalog?.reasoning;
  const supportsReasoning = Boolean(reasoning?.supported);
  elements.quickReasoningRow.hidden = !supportsReasoning;
  if (supportsReasoning) {
    const selectedEffort = reasoning.efforts.includes(config.effectiveReasoning?.effort ?? config.reasoningEffort)
      ? (config.effectiveReasoning?.effort ?? config.reasoningEffort)
      : reasoning.defaultEffort;
    renderQuickSelect(elements.quickReasoningSelect, elements.quickReasoningOptions, reasoning.efforts, selectedEffort, reasoningEffortLabel);
  }
  const reasoningLabel = supportsReasoning ? ` · 推理${reasoningEffortLabel(config.effectiveReasoning?.effort ?? config.reasoningEffort)}` : "";
  elements.quickModelLabel.textContent = `${config.model || "模型配置"}${reasoningLabel}`;
  const capabilities = config.capabilities ?? {};
  const supportedInputs = [
    capabilities.input?.text !== false ? "文本" : null,
    capabilities.input?.image ? "图片" : null,
    capabilities.input?.pdf ? "PDF" : null,
    capabilities.toolCalling !== false ? "工具调用" : null
  ].filter(Boolean);
  const unavailableInputs = [
    capabilities.input?.image ? null : "图片",
    capabilities.input?.pdf ? null : "PDF"
  ].filter(Boolean);
  const cacheLabel = capabilities.promptCache?.mode === "automatic" && capabilities.promptCache?.enabled
    ? "自动缓存"
    : capabilities.promptCache?.mode === "explicit"
      ? capabilities.promptCache?.enabled ? "显式缓存已启用" : "可配置显式缓存"
      : "无缓存声明";
  elements.quickCapabilitySummary.innerHTML = `<strong>本轮能力</strong><span>${escapeHtml(supportedInputs.join(" · "))}</span><small>${escapeHtml(unavailableInputs.length ? `${unavailableInputs.join("、")}仅保留附件记录 · ${cacheLabel}` : cacheLabel)}</small>`;
  renderAttachments();
}

async function saveQuickModelConfig(patch) {
  state.modelConfig = await api("/api/config", { method: "POST", body: JSON.stringify(patch) });
  renderQuickModelSettings();
  renderUsage();
}

function syncDesktopUnreadBadge() {
  const count = countUnreadCompletions(state.sessions.active, state.seenTerminalEventIds);
  window.codepilotDesktop?.setUnreadCount?.(count);
}

function acknowledgeSessionCompletion(session) {
  if (!session?.latestTerminalEventId || state.seenTerminalEventIds.has(session.latestTerminalEventId)) return;
  state.seenTerminalEventIds.add(session.latestTerminalEventId);
  localStorage.setItem(seenTerminalsStorageKey, persistSeenTerminalEventIds(state.seenTerminalEventIds));
  const item = elements.list.querySelector(`[data-session-id="${CSS.escape(session.id)}"]`);
  if (item) {
    item.dataset.attention = "idle";
    item.querySelector(".session-state-indicator")?.remove();
  }
  syncDesktopUnreadBadge();
}

function sessionFromItem(item) {
  const catalog = item.dataset.archived === "true" ? state.sessions.archived : state.sessions.active;
  return catalog.find((candidate) => candidate.id === item.dataset.sessionId) ?? null;
}

function cancelSessionRename(item, { restoreFocus = true } = {}) {
  item.classList.remove("is-renaming");
  item.querySelector(".session-rename-input")?.remove();
  if (restoreFocus) item.querySelector(".session-menu-toggle")?.focus();
}

function beginSessionRename(item) {
  const session = sessionFromItem(item);
  if (!session || item.classList.contains("is-renaming")) return;
  item.querySelector(".session-menu").hidden = true;
  item.classList.add("is-renaming");
  const input = document.createElement("input");
  input.className = "session-rename-input";
  input.type = "text";
  input.maxLength = 80;
  input.value = session.title;
  input.setAttribute("aria-label", "重命名会话");
  item.append(input);
  input.focus();
  input.select();
}

async function commitSessionRename(item) {
  const input = item.querySelector(".session-rename-input");
  if (!input || input.dataset.saving === "true") return;
  const session = sessionFromItem(item);
  const title = input.value.trim().replace(/\s+/g, " ");
  if (!title) {
    showRuntimeNotice("会话名称需要包含文字。");
    input.focus();
    return;
  }
  if (title === session?.title) {
    cancelSessionRename(item);
    return;
  }
  input.dataset.saving = "true";
  input.disabled = true;
  try {
    const renamed = await api(`/api/sessions/${item.dataset.sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title })
    });
    if (state.session?.id === renamed.id) {
      state.events = await api(`/api/sessions/${renamed.id}/events`);
      state.session.title = renamed.title;
      render();
    }
    await refreshSessions();
  } catch (error) {
    console.error(error);
    cancelSessionRename(item, { restoreFocus: false });
    showRuntimeNotice("会话重命名失败，原名称保持不变。");
  }
}

function renderSessionItem(session, archived, { projectId = state.project.currentProjectId, actions = true } = {}) {
  const selectedSessionId = state.projectSwitch?.sessionId ?? state.session?.id;
  const { sessionCurrent } = derivePrimaryNavigation(state.primaryNavigation, {
    currentSessionId: selectedSessionId,
    candidateSessionId: session.id
  });
  const attention = archived ? "idle" : deriveSessionAttention(session, state.seenTerminalEventIds);
  const indicator = attention === "running"
    ? '<span class="session-state-indicator is-running" role="status" aria-label="任务执行中"><span></span></span>'
    : attention === "completed_unread"
      ? '<span class="session-state-indicator is-complete" role="status" aria-label="任务已完成"></span>'
      : "";
  const taskTitle = displayTaskTitle(session.title);
  const actionMenu = actions && !state.projectSwitch
    ? `<button class="session-menu-toggle" type="button" aria-label="任务操作" aria-haspopup="menu" aria-expanded="false">${icon("more")}</button><div class="session-menu" role="menu" hidden><button type="button" role="menuitem" data-action="rename">重命名</button><button type="button" role="menuitem" data-action="${archived ? "restore" : "archive"}">${archived ? "恢复任务" : "归档任务"}</button><button type="button" role="menuitem" data-action="delete">删除任务</button></div>`
    : "";
  const current = sessionCurrent && projectId === navigationProjectId();
  return `<div class="session-item" data-session-id="${escapeHtml(session.id)}" data-project-id="${escapeHtml(projectId ?? "")}" data-workspace-target-id="${escapeHtml(session.workspaceTargetId ?? "")}" data-archived="${archived}" data-attention="${attention}"><button class="session-row ${current ? "active" : ""}" type="button" title="${escapeHtml(taskTitle)}"${current ? ' aria-current="page"' : ""}${state.projectSwitch ? " disabled" : ""}><span class="session-title">${escapeHtml(taskTitle)}</span></button>${indicator}${actionMenu}</div>`;
}

async function refreshSessions() {
  const result = await api("/api/sessions");
  if (!state.sessionAttentionInitialized) {
    state.seenTerminalEventIds = baselineSeenTerminalEventIds(
      [...result.active, ...result.archived],
      state.seenTerminalEventIds
    );
    localStorage.setItem(seenTerminalsStorageKey, persistSeenTerminalEventIds(state.seenTerminalEventIds));
    state.sessionAttentionInitialized = true;
  }
  state.sessions = result;
  state.project.projects = state.project.projects.map((project) => project.id === state.project.currentProjectId
    ? { ...project, tasks: result.active, archivedTasks: result.archived }
    : project);
  renderProjectNavigation();
  syncDesktopUnreadBadge();
  return result;
}

async function loadCurrentProjectRuntime(navigationIntent = {}) {
  await loadProjectContext();
  const [config, catalog, sessions] = await Promise.all([
    api("/api/config"),
    api("/api/providers/catalog"),
    refreshSessions()
  ]);
  state.modelConfig = config;
  state.providerCatalog = catalog;
  syncPermissionMode();
  renderAttachments();
  renderQuickModelSettings();
  renderUsage();

  if (navigationIntent.newTask) {
    await createNewSession({ allowDuringProjectSwitch: true });
    return sessions;
  }
  const targetSession = [...sessions.active, ...sessions.archived].find((session) => session.id === navigationIntent.sessionId)
    ?? sessions.active.find((session) => session.workspaceTargetId === state.project.currentWorkspaceTargetId)
    ?? sessions.archived.find((session) => session.workspaceTargetId === state.project.currentWorkspaceTargetId);
  if (targetSession) {
    await loadSession(targetSession, { refreshList: false });
    return sessions;
  }

  sessionLoadEpoch += 1;
  state.session = null;
  state.events = [];
  state.capabilities = null;
  state.running = false;
  state.runStartEventCount = 0;
  hidePermission();
  hideEventLog();
  render();
  await loadCapabilities();
  syncRunAction();
  return sessions;
}

async function loadSession(session, { refreshList = true } = {}) {
  rememberCurrentConversation();
  captureConversationViewport();
  if (state.pollTimer) clearTimeout(state.pollTimer);
  state.pollTimer = null;
  stopHeartbeat();
  stopElapsedClock();
  const loadEpoch = ++sessionLoadEpoch;
  acknowledgeSessionCompletion(session);
  const events = await api(`/api/sessions/${session.id}/events`);
  if (loadEpoch !== sessionLoadEpoch) return;
  state.session = session;
  state.inspectorView = "runtime";
  state.selectedChangeRunId = null;
  state.events = events;
  const attachment = deriveRunAttachment(events, session);
  state.running = attachment.running;
  state.runStartEventCount = attachment.runStartEventCount;
  rememberCurrentConversation();
  hidePermission();
  hideEventLog();
  render({ scrollToLatest: false });
  restoreConversationViewport(session.id);
  await loadCapabilities({ loadEpoch });
  if (refreshList) await refreshSessions();
  if (state.running && loadEpoch === sessionLoadEpoch) {
    startHeartbeat();
    startElapsedClock();
    syncRunAction();
    pollSession().catch(handlePollingFailure);
  }
}

async function createNewSession({ projectId = state.project.currentProjectId, allowDuringProjectSwitch = false } = {}) {
  if (state.projectSwitch && !allowDuringProjectSwitch) return null;
  if (projectId && projectId !== state.project.currentProjectId) {
    await switchProjectFromNavigation(projectId, { newTask: true });
    return null;
  }
  const session = await api("/api/sessions", { method: "POST", body: JSON.stringify({ title: "新建任务" }) });
  await loadSession(session);
  elements.input.focus();
}

async function runTask(task) {
  if (state.projectSwitch) return;
  if (state.running) return cancelTask();
  if (!task.trim()) return;
  if (!state.session || state.session.archived) await createNewSession();
  state.session.title = task.trim().slice(0, 44);
  state.runStartEventCount = state.events.length;
  state.running = true;
  startHeartbeat();
  hideRuntimeNotice();
  startElapsedClock();
  elements.input.value = "";
  const attachments = [...state.attachments];
  state.attachments = [];
  renderAttachments();
  resizeTaskInput();
  syncRunAction();
  try {
    const runRequest = api(`/api/sessions/${state.session.id}/run`, { method: "POST", body: JSON.stringify({ task, attachments, permissionMode: state.permissionMode }) });
    pollSession().catch(handlePollingFailure);
    await runRequest;
    await refreshSessions();
  } catch (error) {
    handlePollingFailure(error);
  }
}

async function cancelTask() {
  if (!state.running || !state.session) return;
  elements.send.disabled = true;
  try {
    await api(`/api/sessions/${state.session.id}/cancel`, { method: "POST" });
  } catch (error) {
    elements.send.disabled = false;
    showRuntimeNotice("停止任务失败，请检查本地服务后重试。");
    throw error;
  }
}

function handlePollingFailure(error) {
  console.error(error);
  state.running = false;
  stopHeartbeat();
  stopElapsedClock();
  syncRunAction();
  showRuntimeNotice("无法更新运行状态。请检查本地服务后重试。");
}

async function pollSession() {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  const lastSequence = state.events.at(-1)?.sequence ?? 0;
  const incomingEvents = await api(`/api/sessions/${state.session.id}/events?after=${lastSequence}`);
  const eventsChanged = incomingEvents.length > 0;
  const nextEvents = eventsChanged ? [...state.events, ...incomingEvents] : state.events;
  const shouldStickToBottom = isNearTimelineBottom();
  state.events = nextEvents;
  if (eventsChanged && shouldRenderIncomingEvents(incomingEvents)) {
    const runId = incomingEvents[0]?.data?.runId;
    const patched = canPatchTraceOnly(incomingEvents) && patchRunTrace(runId);
    if (!patched) render({ scrollToLatest: shouldStickToBottom });
    else {
      renderTodoList();
      if (shouldStickToBottom) elements.scroll.scrollTop = elements.scroll.scrollHeight;
    }
  }
  if (incomingEvents.some((event) => event.type === "capability_snapshot_created")) loadCapabilities().catch(console.error);
  const finished = state.events.slice(state.runStartEventCount).some((event) => event.type === "agent_final" || event.type === "agent_error" || (event.type === "run_state_changed" && ["failed", "cancelled"].includes(event.data?.to)));
  if (finished) {
    state.running = false;
    stopElapsedClock();
    stopHeartbeat();
    syncRunAction();
    render({ scrollToLatest: shouldStickToBottom });
    await refreshSessions();
    return;
  }
  state.pollTimer = setTimeout(() => pollSession().catch(handlePollingFailure), 300);
}

elements.form.addEventListener("submit", (event) => { event.preventDefault(); runTask(elements.input.value).catch(console.error); });
elements.input.addEventListener("input", () => { resizeTaskInput(); syncRunAction(); });
elements.workspaceTargetTrigger.addEventListener("click", () => {
  const opening = elements.workspaceTargetMenu.hidden;
  closeComposerPopovers();
  elements.workspaceTargetMenu.hidden = !opening;
  if (opening) positionComposerPopover(elements.workspaceTargetMenu, elements.workspaceTargetTrigger);
  elements.workspaceTargetTrigger.setAttribute("aria-expanded", String(opening));
});
elements.workspaceTargetMenu.addEventListener("click", async (event) => {
  const project = currentProject();
  const workspaceTargetId = event.target.closest("[data-workspace-target]")?.dataset.workspaceTarget;
  if (!workspaceTargetId) return;
  closeComposerPopovers();
  if (project && workspaceTargetId === "__create_isolated_worktree__") {
    creatingIsolatedWorktree = true;
    renderComposerWorkspaceTarget();
    try {
      const created = await window.codepilotDesktop.createIsolatedProjectWorktree(project.id);
      await switchProjectFromNavigation(project.id, { workspaceTargetId: created.workspaceTargetId, newTask: true });
    } catch (error) {
      showRuntimeNotice(error instanceof Error ? error.message : "隔离工作树创建失败。");
    } finally {
      creatingIsolatedWorktree = false;
      renderComposerWorkspaceTarget();
    }
    return;
  }
  if (!project || !workspaceTargetId || workspaceTargetId === state.project.currentWorkspaceTargetId) return;
  await switchProjectFromNavigation(project.id, { workspaceTargetId, newTask: true }).catch((error) => {
    showRuntimeNotice(error instanceof Error ? error.message : "工作树切换失败，请重试。");
    renderComposerWorkspaceTarget();
  });
});
elements.inspectorToggle.addEventListener("click", () => {
  state.inspectorView = "runtime";
  state.inspectorLayout = toggleInspector(state.inspectorLayout);
  renderInspectorLayout({ moveFocus: true });
});
elements.inspectorClose.addEventListener("click", () => updateInspectorOpen(false, { moveFocus: true }));
elements.inspectorScrim.addEventListener("click", () => updateInspectorOpen(false, { moveFocus: true }));
elements.changeReview.addEventListener("click", (event) => {
  const contextButton = event.target.closest("[data-review-context]");
  if (contextButton) {
    const mode = contextButton.dataset.reviewContext;
    if (mode !== "compact" && mode !== "full") return;
    state.reviewContextMode = mode;
    renderChangeReview();
    requestAnimationFrame(() => elements.changeReview.querySelector(`[data-review-context="${mode}"]`)?.focus());
    return;
  }
  const streamedText = events.filter((event) => event.type === "model_text_delta").map((event) => event.data?.delta ?? "").join("");
  if (live && streamedText.trim()) {
    activities.push(`<section class="trace-analysis is-streaming trace-response-stream"><div class="trace-analysis-head"><span class="trace-activity-icon" aria-hidden="true">${icon("sparkles")}</span><span>正在生成回复</span></div><div class="trace-analysis-body markdown-output">${renderMarkdown(streamedText)}</div></section>`);
  }

  const action = event.target.closest("[data-review-action]")?.dataset.reviewAction;
  if (action === "expand-all" || action === "collapse-all") {
    const open = action === "expand-all";
    elements.changeReview.querySelectorAll(".review-file").forEach((file) => { file.open = open; });
    return;
  }

});
elements.attachFile.addEventListener("click", () => elements.attachmentInput.click());
elements.attachmentInput.addEventListener("change", async () => {
  try {
    await addAttachments(elements.attachmentInput.files);
  } finally {
    elements.attachmentInput.value = "";
  }
});
elements.attachmentList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-remove-attachment]");
  if (!button) return;
  state.attachments.splice(Number(button.dataset.removeAttachment), 1);
  renderAttachments();
});
document.addEventListener("dragenter", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth += 1;
  setFileDropActive(true);
});
document.addEventListener("dragover", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (event) => {
  if (!isFileDrag(event)) return;
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) setFileDropActive(false);
});
document.addEventListener("drop", (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault();
  fileDragDepth = 0;
  setFileDropActive(false);
  addAttachments(event.dataTransfer.files).catch(console.error);
});
window.addEventListener("blur", () => {
  fileDragDepth = 0;
  setFileDropActive(false);
});
elements.permissionModeTrigger.addEventListener("click", () => {
  const opening = elements.permissionModeMenu.hidden;
  closeComposerPopovers();
  elements.permissionModeMenu.hidden = !opening;
  if (opening) positionComposerPopover(elements.permissionModeMenu, elements.permissionModeTrigger);
  elements.permissionModeTrigger.setAttribute("aria-expanded", String(opening));
});
elements.permissionModeMenu.addEventListener("click", (event) => {
  const option = event.target.closest("[data-permission-mode]");
  if (!option) return;
  state.permissionMode = option.dataset.permissionMode;
  syncPermissionMode();
  closeComposerPopovers();
});
elements.quickModelTrigger.addEventListener("click", async () => {
  const opening = elements.quickModelMenu.hidden;
  closeComposerPopovers();
  if (opening) {
    if (!Object.keys(state.providerCatalog).length) state.providerCatalog = await api("/api/providers/catalog");
    if (!state.modelConfig) state.modelConfig = await api("/api/config");
    renderQuickModelSettings();
  }
  elements.quickModelMenu.hidden = !opening;
  if (opening) positionComposerPopover(elements.quickModelMenu, elements.quickModelTrigger, "right");
  elements.quickModelTrigger.setAttribute("aria-expanded", String(opening));
});
elements.quickModelSelect.addEventListener("click", () => toggleQuickSelect(elements.quickModelSelect, elements.quickModelOptions, elements.quickReasoningOptions));
elements.quickReasoningSelect.addEventListener("click", () => toggleQuickSelect(elements.quickReasoningSelect, elements.quickReasoningOptions, elements.quickModelOptions));
elements.quickModelOptions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-quick-value]");
  if (!option) return;
  saveQuickModelConfig({ model: option.dataset.quickValue }).then(closeComposerPopovers).catch((error) => showRuntimeNotice(error.message));
});
elements.quickReasoningOptions.addEventListener("click", (event) => {
  const option = event.target.closest("[data-quick-value]");
  if (!option) return;
  saveQuickModelConfig({ thinkingEnabled: true, reasoningEffort: option.dataset.quickValue }).then(closeComposerPopovers).catch((error) => showRuntimeNotice(error.message));
});
document.querySelector("#open-advanced-model-settings").addEventListener("click", () => { closeComposerPopovers(); openModelSettings().catch(console.error); });
document.querySelector("#reset-model-config").addEventListener("click", async () => {
  try {
    state.modelConfig = await api("/api/config/reset", { method: "POST" });
    renderQuickModelSettings();
    renderUsage();
    closeComposerPopovers();
    showRuntimeNotice("已恢复默认模型设置。");
  } catch (error) {
    showRuntimeNotice(error instanceof Error ? error.message : "重置模型配置失败");
  }
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".composer-menu-anchor")) closeComposerPopovers();
});
window.addEventListener("resize", () => {
  resizeTaskInput();
  if (!elements.workspaceTargetMenu.hidden) positionComposerPopover(elements.workspaceTargetMenu, elements.workspaceTargetTrigger);
  if (!elements.permissionModeMenu.hidden) positionComposerPopover(elements.permissionModeMenu, elements.permissionModeTrigger);
  if (!elements.quickModelMenu.hidden) positionComposerPopover(elements.quickModelMenu, elements.quickModelTrigger, "right");
});
inspectorMedia.addEventListener("change", (event) => {
  state.inspectorLayout = transitionInspectorViewport(state.inspectorLayout, event.matches);
  inspectorReturnFocus = null;
  renderInspectorLayout();
});
sidebarMedia.addEventListener("change", () => {
  state.sidebarOpen = false;
  renderSidebarDrawer();
});
elements.sidebarToggle.addEventListener("click", () => setSidebarOpen(!state.sidebarOpen));
elements.sidebarScrim.addEventListener("click", () => setSidebarOpen(false));
elements.sidebar.addEventListener("click", (event) => {
  if (!sidebarMedia.matches) return;
  if (event.target.closest("#new-session, #sidebar-settings, .skills-nav-button, .mcp-nav-button, .session-row, [data-project-new]")) setSidebarOpen(false);
});
elements.timeline.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  const traceId = details.dataset.traceId;
  const batchId = details.dataset.toolBatchId;
  if (traceId) {
    if (details.dataset.traceLive !== "true") {
      if (details.open) state.openTraces.add(traceId);
      else state.openTraces.delete(traceId);
    }
  }
  if (batchId) {
    if (details.open) state.openToolBatches.add(batchId);
    else state.openToolBatches.delete(batchId);
  }
}, true);
elements.todoList.addEventListener("toggle", (event) => {
  const details = event.target;
  if (!(details instanceof HTMLDetailsElement)) return;
  const runId = details.dataset.todoRunId;
  if (!runId) return;
  if (details.open) state.openTodoLists.add(runId);
  else state.openTodoLists.delete(runId);
}, true);
elements.timeline.addEventListener("click", async (event) => {
  const traceFile = event.target.closest("[data-trace-file-run]");
  if (traceFile) {
    event.preventDefault();
    event.stopPropagation();
    openChangeReview(traceFile.dataset.traceFileRun);
    return;
  }
  const action = event.target.closest("[data-change-action]");
  if (!action) return;
  const card = action.closest("[data-change-run-id]");
  const runId = card?.dataset.changeRunId;
  if (!runId) return;
  if (action.dataset.changeAction === "review") {
    openChangeReview(runId);
    return;
  }
  if (action.dataset.changeAction !== "revert") return;
  const changeSet = buildRunChangeSet(state.events, runId);
  const confirmed = await confirmations.confirm({
    title: `撤销 ${changeSet.files.length} 个文件的更改？`,
    message: "CodePilot 会先核对文件仍是本轮完成时的版本，再恢复本轮开始前的内容。",
    detail: changeSet.files.map(({ path }) => path).join("\n"),
    confirmLabel: "撤销更改",
    tone: "danger",
    returnFocus: action
  });
  if (!confirmed) return;
  action.disabled = true;
  try {
    await api(`/api/sessions/${state.session.id}/changes/revert`, {
      method: "POST",
      body: JSON.stringify({ runId })
    });
    state.events = await api(`/api/sessions/${state.session.id}/events`);
    render();
    showRuntimeNotice("已恢复本轮修改前的文件内容。");
  } catch (error) {
    action.disabled = false;
    showRuntimeNotice(error instanceof Error ? error.message : "撤销更改失败");
  }
});
elements.turnNavigation.addEventListener("click", (event) => {
  const targetId = event.target.closest("[data-turn-target]")?.dataset.turnTarget;
  if (!targetId) return;
  const target = elements.timeline.querySelector(`[data-turn-id="${CSS.escape(targetId)}"]`);
  if (!target) return;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  elements.scroll.scrollTo({ top: Math.max(0, anchorContentTop(target) - 12), behavior: reduceMotion ? "auto" : "smooth" });
});
elements.scroll.addEventListener("scroll", () => {
  if (restoringConversationViewport || viewportSaveFrame) return;
  viewportSaveFrame = requestAnimationFrame(() => {
    viewportSaveFrame = null;
    captureConversationViewport();
  });
}, { passive: true });
window.addEventListener("beforeunload", () => captureConversationViewport());
elements.addProject.addEventListener("click", openProjectCreateDialog);
elements.projectCreateName.addEventListener("input", () => {
  setProjectCreateError();
  syncProjectCreateForm();
});
elements.projectWorkspacePicker.addEventListener("click", () => chooseProjectWorkspace().catch((error) => {
  setProjectCreateError(error instanceof Error ? error.message : "工作区选择失败，请重试。");
}));
elements.projectCreateCancel.addEventListener("click", () => closeProjectCreateDialog());
elements.projectCreateClose.addEventListener("click", () => closeProjectCreateDialog());
elements.projectCreateDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeProjectCreateDialog();
});
elements.projectCreateDialog.addEventListener("click", (event) => {
  if (event.target === elements.projectCreateDialog) closeProjectCreateDialog();
});
elements.projectCreateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!projectWorkspaceSelection || !elements.projectCreateName.value.trim()) return;
  setProjectCreateError();
  elements.projectCreateSubmit.disabled = true;
  elements.projectCreateSubmit.textContent = "创建中…";
  try {
    const receipt = await window.codepilotDesktop.createProject({
      selectionId: projectWorkspaceSelection.selectionId,
      name: elements.projectCreateName.value.trim()
    });
    closeProjectCreateDialog();
    await loadCurrentProjectRuntime(receipt?.navigationIntent ?? {});
  } catch (error) {
    setProjectCreateError(error instanceof Error ? error.message : "项目创建失败，请重试。");
  } finally {
    elements.projectCreateSubmit.textContent = "创建项目";
    syncProjectCreateForm();
  }
});
elements.projectEditForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = state.managedProjectId;
  const name = elements.projectEditName.value.trim();
  if (!projectId || !name) return setProjectEditError("请输入项目名称。");
  elements.projectEditSubmit.disabled = true;
  try {
    const receipt = await window.codepilotDesktop.renameProject(projectId, name);
    state.project = { ...state.project, ...receipt };
    closeProjectEditDialog();
    renderProjectNavigation();
  } catch (error) {
    setProjectEditError(error instanceof Error ? error.message : "项目名称保存失败。");
  } finally {
    elements.projectEditSubmit.disabled = false;
  }
});
elements.projectEditCancel.addEventListener("click", closeProjectEditDialog);
elements.projectEditClose.addEventListener("click", closeProjectEditDialog);
elements.projectEditDialog.addEventListener("cancel", () => { state.managedProjectId = null; });
elements.worktreeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = state.managedProjectId;
  const slug = elements.worktreeSlug.value.trim();
  if (!projectId || !slug) return setWorktreeError("请输入工作树名称。");
  elements.worktreeCreate.disabled = true;
  elements.worktreeCreate.textContent = "创建中…";
  setWorktreeError();
  try {
    const result = await window.codepilotDesktop.createProjectWorktree(projectId, slug);
    if (!result?.cancelled) {
      renderWorktreeDialog(result);
      elements.worktreeSlug.value = "";
      await loadProjectContext();
    }
  } catch (error) {
    setWorktreeError(error instanceof Error ? error.message : "永久工作树创建失败。");
  } finally {
    elements.worktreeCreate.textContent = "创建永久工作树";
    const actionState = state.projectActions.get(projectId);
    elements.worktreeCreate.disabled = !actionState?.git.available || state.running;
  }
});
elements.worktreeCancel.addEventListener("click", closeWorktreeDialog);
elements.worktreeClose.addEventListener("click", closeWorktreeDialog);
elements.worktreeDialog.addEventListener("cancel", () => { state.managedProjectId = null; });
elements.githubDone.addEventListener("click", closeGitHubDialog);
elements.githubClose.addEventListener("click", closeGitHubDialog);
elements.githubDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeGitHubDialog();
});
elements.githubDialog.addEventListener("click", (event) => {
  if (event.target === elements.githubDialog) closeGitHubDialog();
});
elements.githubConnectForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = state.managedProjectId;
  const repository = elements.githubRepositoryInput.value.trim();
  if (!projectId || !repository) return;
  const confirmed = await confirmations.confirm({
    title: "连接这个 GitHub 仓库？",
    message: "CodePilot 将验证仓库，并在当前 Git 项目中添加名为 github 的 remote。现有 remote 保持不变。",
    detail: repository,
    detailMeta: "本地 Git 配置变更",
    confirmLabel: "连接仓库",
    returnFocus: elements.githubConnect
  });
  if (!confirmed) return;
  setGitHubError();
  elements.githubConnect.disabled = true;
  elements.githubConnect.textContent = "连接中…";
  try {
    renderGitHubDialog(await window.codepilotDesktop.connectProjectGitHubRepository(projectId, repository));
    showRuntimeNotice("GitHub 仓库已连接。");
  } catch (error) {
    setGitHubError(error instanceof Error ? error.message : "GitHub 仓库连接失败。");
  } finally {
    elements.githubConnect.disabled = false;
    elements.githubConnect.textContent = "连接仓库";
  }
});
elements.githubPush.addEventListener("click", async () => {
  const projectId = state.managedProjectId;
  if (!projectId || !githubConnectionState?.available) return;
  const confirmed = await confirmations.confirm({
    title: "Push 当前分支到 GitHub？",
    message: "CodePilot 将通过本机 Git 向 origin 推送当前分支并设置 upstream。",
    detail: githubConnectionState.branch,
    detailMeta: "远端写操作",
    confirmLabel: "确认 Push",
    returnFocus: elements.githubPush
  });
  if (!confirmed) return;
  setGitHubError();
  elements.githubPush.disabled = true;
  elements.githubPush.textContent = "Push 中…";
  try {
    renderGitHubDialog(await window.codepilotDesktop.pushProjectGitHubBranch(projectId));
    showRuntimeNotice("当前分支已推送到 GitHub。");
  } catch (error) {
    setGitHubError(error instanceof Error ? error.message : "GitHub Push 失败。");
  } finally {
    elements.githubPush.textContent = "Push branch";
    elements.githubPush.disabled = !githubConnectionState?.available || state.running;
  }
});
elements.githubPrForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const projectId = state.managedProjectId;
  if (!projectId || !githubConnectionState?.available || githubConnectionState.pullRequest) return;
  const value = {
    title: elements.githubPrTitle.value.trim(),
    base: elements.githubPrBase.value.trim(),
    body: elements.githubPrBody.value.trim()
  };
  if (!value.title || !value.base) return setGitHubError("请输入 PR 标题与 Base branch。");
  const confirmed = await confirmations.confirm({
    title: "创建 Pull Request？",
    message: "CodePilot 将通过已认证的 GitHub CLI 在当前仓库创建 Pull Request。",
    detail: value.title,
    detailMeta: `${githubConnectionState.branch} → ${value.base}`,
    confirmLabel: "创建 PR",
    returnFocus: elements.githubCreatePr
  });
  if (!confirmed) return;
  setGitHubError();
  elements.githubCreatePr.disabled = true;
  elements.githubCreatePr.textContent = "创建中…";
  try {
    renderGitHubDialog(await window.codepilotDesktop.createProjectGitHubPullRequest(projectId, value));
    showRuntimeNotice("Pull Request 已创建，Checks 状态会显示在连接面板中。");
  } catch (error) {
    setGitHubError(error instanceof Error ? error.message : "Pull Request 创建失败。");
  } finally {
    elements.githubCreatePr.textContent = "创建 PR";
    elements.githubCreatePr.disabled = !githubConnectionState?.available || Boolean(githubConnectionState?.pullRequest) || state.running;
  }
});
elements.worktreeList.addEventListener("click", async (event) => {
  const projectId = state.managedProjectId;
  if (!projectId) return;
  const openTarget = event.target.closest("[data-worktree-open]")?.dataset.worktreeOpen;
  if (openTarget) return window.codepilotDesktop.openProjectWorkspace(projectId, openTarget).catch((error) => setWorktreeError(error.message));
  const switchTarget = event.target.closest("[data-worktree-switch]")?.dataset.worktreeSwitch;
  if (switchTarget) {
    closeWorktreeDialog();
    await switchProjectFromNavigation(projectId, { workspaceTargetId: switchTarget });
    return;
  }
  const removeTarget = event.target.closest("[data-worktree-remove]")?.dataset.worktreeRemove;
  if (!removeTarget) return;
  const actionState = state.projectActions.get(projectId);
  const target = actionState?.targets.find((candidate) => candidate.id === removeTarget);
  const confirmed = await confirmations.confirm({
    title: "移除这个永久工作树？",
    message: "仅在工作树干净且没有额外提交或绑定任务时执行 Git 移除。",
    detail: target?.branch || "永久工作树",
    detailMeta: "本地文件由 Git 安全检查保护",
    confirmLabel: "移除工作树",
    tone: "danger",
    returnFocus: elements.worktreeDialog
  });
  if (!confirmed) return;
  try {
    renderWorktreeDialog(await window.codepilotDesktop.removeProjectWorktree(projectId, removeTarget));
    await loadProjectContext();
  } catch (error) {
    setWorktreeError(error instanceof Error ? error.message : "工作树移除失败。");
  }
});
document.querySelector("#new-session").addEventListener("click", () => {
  closePrimaryCapabilityView();
  createNewSession({ projectId: state.project.defaultProjectId }).catch(console.error);
});
document.querySelector("#open-skills").addEventListener("click", openSkillsView);
document.querySelector("#open-skills-mobile").addEventListener("click", openSkillsView);
document.querySelector("#close-skills").addEventListener("click", closeSkillsView);
document.querySelector("#open-mcp").addEventListener("click", openMcpView);
document.querySelector("#open-mcp-mobile").addEventListener("click", openMcpView);
document.querySelector("#close-mcp").addEventListener("click", closeMcpView);
elements.skillsSearch.addEventListener("input", () => {
  state.skillQuery = elements.skillsSearch.value;
  renderCapabilities();
});
document.querySelectorAll("[data-task]").forEach((button) => button.addEventListener("click", () => runTask(button.dataset.task).catch(console.error)));
elements.list.addEventListener("click", async (event) => {
  if (state.projectSwitch) return;
  const projectGroup = event.target.closest(".project-navigation-group");
  const projectIdForAction = projectGroup?.dataset.projectId;
  const projectMenuToggle = event.target.closest(".project-menu-toggle");
  if (projectMenuToggle) {
    const menu = projectGroup.querySelector(".project-menu");
    const shouldOpen = menu.hidden;
    closeProjectMenus();
    menu.hidden = !shouldOpen;
    projectMenuToggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      const rect = projectMenuToggle.getBoundingClientRect();
      const menuWidth = 218;
      const menuHeight = menu.offsetHeight || 244;
      menu.style.left = `${Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8))}px`;
    }
    return;
  }
  const projectAction = event.target.closest("[data-project-action]")?.dataset.projectAction;
  if (projectAction && projectIdForAction) {
    const project = state.project.projects.find((candidate) => candidate.id === projectIdForAction);
    closeProjectMenus();
    if (!project) return;
    try {
      if (projectAction === "pin") {
      const receipt = await window.codepilotDesktop.setProjectPinned(project.id, !project.pinned);
      state.project = { ...state.project, ...receipt };
      renderProjectNavigation();
    } else if (projectAction === "open") {
      await window.codepilotDesktop.openProjectWorkspace(project.id);
    } else if (projectAction === "worktrees") {
      await openWorktreeDialog(project.id);
    } else if (projectAction === "github") {
      await openGitHubDialog(project.id);
    } else if (projectAction === "edit") {
      openProjectEditDialog(project);
    } else if (projectAction === "archive") {
      const confirmed = await confirmations.confirm({ title: "归档这个项目的聊天？", message: "项目中的活跃 Task 会移到已归档分组，JSONL 事实保留。", detail: project.name, confirmLabel: "归档聊天", returnFocus: projectMenuToggle });
      if (confirmed) {
        await window.codepilotDesktop.archiveProjectChats(project.id);
        if (project.id === state.project.currentProjectId) await refreshSessions();
        else await loadProjectContext();
      }
    } else if (projectAction === "remove") {
      const confirmed = await confirmations.confirm({ title: "移除这个项目？", message: "项目会从 CodePilot 侧栏移除，本地文件和 Git 工作树保持不变。", detail: project.name, detailMeta: "不会删除任何项目文件", confirmLabel: "移除项目", tone: "danger", returnFocus: projectMenuToggle });
      if (confirmed) {
        const wasCurrent = project.id === state.project.currentProjectId;
        await window.codepilotDesktop.removeProject(project.id);
        if (wasCurrent) await loadCurrentProjectRuntime();
        else await loadProjectContext();
      }
      }
    } catch (error) {
      showRuntimeNotice(error instanceof Error ? error.message : "项目操作失败，请重试。");
    }
    return;
  }
  const projectNew = event.target.closest("[data-project-new]")?.dataset.projectNew;
  if (projectNew) {
    closePrimaryCapabilityView();
    await createNewSession({ projectId: projectNew });
    return;
  }
  const projectToggle = event.target.closest("[data-project-toggle]")?.dataset.projectToggle;
  if (projectToggle) {
    if (state.collapsedProjectIds.has(projectToggle)) state.collapsedProjectIds.delete(projectToggle);
    else state.collapsedProjectIds.add(projectToggle);
    persistCollapsedProjects();
    renderProjectNavigation();
    return;
  }
  const item = event.target.closest(".session-item");
  if (!item) return;
  const sessionId = item.dataset.sessionId;
  const projectId = item.dataset.projectId;
  const workspaceTargetId = item.dataset.workspaceTargetId;
  if (projectId && (projectId !== state.project.currentProjectId || (workspaceTargetId && workspaceTargetId !== state.project.currentWorkspaceTargetId))) {
    if (event.target.closest(".session-row")) await switchProjectFromNavigation(projectId, { sessionId });
    return;
  }
  const menu = item.querySelector(".session-menu");
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    const action = actionButton.dataset.action;
    menu.hidden = true;
    item.querySelector(".session-menu-toggle")?.setAttribute("aria-expanded", "false");
    if (action === "rename") {
      beginSessionRename(item);
      return;
    }
    if (action === "delete") {
      const sessionTitle = item.querySelector(".session-row").textContent.trim();
      const confirmed = await confirmations.confirm({
        title: "删除这个会话？",
        message: "会话将从侧栏和本地历史中移除。关联的 JSONL 记录不会进入最近会话列表。",
        detail: sessionTitle,
        detailMeta: "本地会话记录 · 删除后不可撤销",
        confirmLabel: "删除会话",
        tone: "danger",
        returnFocus: item.querySelector(".session-menu-toggle")
      });
      if (!confirmed) return;
    }
    const method = action === "delete" ? "DELETE" : "POST";
    const path = action === "delete" ? `/api/sessions/${sessionId}` : `/api/sessions/${sessionId}/${action}`;
    api(path, { method }).then(async () => {
      if (state.session?.id === sessionId) {
        state.session = null;
        state.events = [];
        state.selectedSkill = null;
        render();
        await loadCapabilities();
      }
      await refreshSessions();
    }).catch((error) => {
      console.error(error);
      showRuntimeNotice(action === "delete" ? "删除对话失败，本地记录保持不变，请重试。" : "会话操作失败，请重试。");
    });
    return;
  }
  if (event.target.closest(".session-menu-toggle")) {
    const toggle = event.target.closest(".session-menu-toggle");
    const shouldOpen = menu.hidden;
    document.querySelectorAll(".session-menu").forEach((candidate) => {
      if (candidate !== menu) {
        candidate.hidden = true;
        candidate.closest(".session-item")?.querySelector(".session-menu-toggle")?.setAttribute("aria-expanded", "false");
      }
    });
    menu.hidden = !shouldOpen;
    toggle.setAttribute("aria-expanded", String(shouldOpen));
    if (shouldOpen) {
      const rect = toggle.getBoundingClientRect();
      const menuWidth = 132;
      const menuHeight = menu.offsetHeight || 124;
      menu.style.left = `${Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8))}px`;
    }
    return;
  }
  if (event.target.closest(".session-row")) {
    closePrimaryCapabilityView();
    const catalog = item.dataset.archived === "true" ? state.sessions.archived : state.sessions.active;
    const session = catalog.find((candidate) => candidate.id === sessionId)
      ?? { id: sessionId, title: item.querySelector(".session-title")?.textContent ?? "对话", archived: item.dataset.archived === "true" };
    loadSession(session).catch(console.error);
  }
});
elements.list.addEventListener("keydown", (event) => {
  const input = event.target.closest(".session-rename-input");
  if (!input) return;
  const item = input.closest(".session-item");
  if (event.key === "Enter") {
    event.preventDefault();
    commitSessionRename(item).catch(console.error);
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancelSessionRename(item);
  }
});
elements.list.addEventListener("focusout", (event) => {
  const input = event.target.closest(".session-rename-input");
  if (!input || input.dataset.saving === "true") return;
  queueMicrotask(() => {
    if (input.isConnected && document.activeElement !== input) {
      commitSessionRename(input.closest(".session-item")).catch(console.error);
    }
  });
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".project-navigation-group")) closeProjectMenus();
  if (!event.target.closest(".session-item")) document.querySelectorAll(".session-menu").forEach((menu) => {
    menu.hidden = true;
    menu.closest(".session-item")?.querySelector(".session-menu-toggle")?.setAttribute("aria-expanded", "false");
  });
});
elements.list.addEventListener("scroll", () => document.querySelectorAll(".session-menu").forEach((menu) => {
  menu.hidden = true;
  menu.closest(".session-item")?.querySelector(".session-menu-toggle")?.setAttribute("aria-expanded", "false");
}));
elements.list.addEventListener("scroll", () => closeProjectMenus());
elements.permission.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-approval]");
  if (!button || !state.pendingPermission) return;
  const decision = button.dataset.approval;
  const tool = state.pendingPermission.data.tool;
  const requestId = state.pendingPermission.data.requestId;
  const buttons = [...elements.permission.querySelectorAll("[data-approval]")];
  buttons.forEach((candidate) => { candidate.disabled = true; });
  try {
    await api(`/api/sessions/${state.session.id}/permission`, { method: "POST", body: JSON.stringify({ requestId, tool, decision }) });
    hidePermission();
    state.events = await api(`/api/sessions/${state.session.id}/events`);
    render();
  } catch (error) {
    console.error(error);
    buttons.forEach((candidate) => { candidate.disabled = false; });
    showRuntimeNotice("审批结果提交失败，请重试；任务仍在等待你的决定。");
  }
});
elements.transcriptButton.addEventListener("click", showEventLog);
elements.skillsLayer.addEventListener("click", async (event) => {
  const skillButton = event.target.closest("[data-skill-name]");
  if (skillButton) {
    skillDetailReturnFocus = skillButton;
    state.selectedSkill = skillButton.dataset.skillName;
    renderCapabilities();
    requestAnimationFrame(() => elements.skillDetailPanel.querySelector("[data-close-skill]")?.focus());
    return;
  }
  if (event.target === elements.skillDetailLayer || event.target.closest("[data-close-skill]")) {
    closeSkillDetail();
    return;
  }
  const uninstall = event.target.closest("[data-uninstall-skill]");
  if (uninstall) {
    const name = uninstall.dataset.uninstallSkill;
    const confirmed = await confirmations.confirm({
      title: `卸载技能“${name}”？`,
      message: "此操作会移除项目中的 Skill 来源文件。",
      detail: "卸载后需要重新安装才能再次使用。",
      confirmLabel: "卸载技能",
      tone: "danger"
    });
    if (!confirmed) return;
    const buttons = [...elements.skillDetailPanel.querySelectorAll("button")];
    buttons.forEach((button) => { button.disabled = true; });
    try {
      const query = state.session ? `?sessionId=${encodeURIComponent(state.session.id)}` : "";
      state.capabilities = await api(`/api/capabilities/skills/${encodeURIComponent(name)}${query}`, { method: "DELETE" });
      closeSkillDetail({ restoreFocus: false });
      showRuntimeNotice(`已卸载技能“${name}”。`);
    } catch (error) {
      console.error(error);
      showRuntimeNotice("技能卸载失败，来源文件未被完整删除，请检查本地服务后重试。");
      buttons.forEach((button) => { button.disabled = false; });
    }
    return;
  }
  const toggle = event.target.closest("[data-toggle-skill]");
  if (!toggle) return;
  toggle.disabled = true;
  try {
    state.capabilities = await api(`/api/capabilities/skills/${encodeURIComponent(toggle.dataset.toggleSkill)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: toggle.dataset.enabled !== "true", sessionId: state.session?.id })
    });
    renderCapabilities();
  } catch (error) {
    console.error(error);
    showRuntimeNotice("Skill 配置保存失败，请检查本地服务后重试。");
    toggle.disabled = false;
  }
});
elements.mcpSearch.addEventListener("input", () => {
  state.mcpQuery = elements.mcpSearch.value;
  renderFeaturedMcpCatalog();
  clearTimeout(state.mcpSearchTimer);
  state.mcpSearchTimer = setTimeout(() => {
    state.mcpRegistry.loaded = false;
    void loadMcpRegistry({ force: true });
  }, 320);
});
elements.refreshMcpRegistry.addEventListener("click", () => {
  state.mcpRegistry.loaded = false;
  void loadMcpRegistry({ force: true });
});
elements.mcpLayer.addEventListener("click", async (event) => {
  const connect = event.target.closest("[data-connect-mcp]");
  if (connect) {
    const productId = connect.dataset.connectMcp;
    if (connect.dataset.authMode === "token") {
      openMcpTokenDialog(productId);
      return;
    }
    connect.disabled = true;
    try {
      const result = await api("/api/mcp/auth/oauth/start", {
        method: "POST",
        body: JSON.stringify({ productId })
      });
      if (state.capabilities?.mcp?.authStates) {
        state.capabilities.mcp.authStates[productId] = { status: result.status, authMode: "oauth" };
      }
      renderCapabilities();
      if (result.authorizationUrl) window.open(result.authorizationUrl, "_blank", "noopener");
      pollMcpAuth(productId);
      showRuntimeNotice("已在浏览器打开授权页；完成后返回 CodePilot。");
    } catch (error) {
      console.error(error);
      showRuntimeNotice(`MCP 连接启动失败：${error.message}`);
      connect.disabled = false;
    }
    return;
  }
  const disconnect = event.target.closest("[data-disconnect-mcp]");
  if (disconnect) {
    const productId = disconnect.dataset.disconnectMcp;
    const confirmed = await confirmations.confirm({
      title: "断开 MCP 连接？",
      message: "这会删除本机加密凭据，并从项目 MCP 配置中移除该服务。",
      detail: "当前正在运行的能力快照保持不变；下一轮不再连接。",
      confirmLabel: "断开连接",
      tone: "danger",
      returnFocus: disconnect
    });
    if (!confirmed) return;
    try {
      stopMcpAuthPolling(productId);
      const query = state.session ? `?sessionId=${encodeURIComponent(state.session.id)}` : "";
      state.capabilities = await api(`/api/mcp/auth/${encodeURIComponent(productId)}${query}`, { method: "DELETE" });
      renderCapabilities();
      showRuntimeNotice("MCP 凭据和项目连接已移除；当前快照保持稳定。");
    } catch (error) {
      console.error(error);
      showRuntimeNotice(`MCP 断开失败：${error.message}`);
    }
    return;
  }
  const install = event.target.closest("[data-install-mcp]");
  if (install) {
    const confirmed = await confirmations.confirm({
      title: `安装 MCP“${install.dataset.installMcp}”？`,
      message: "安装会把官方 Registry 中的启动信息写入项目配置。",
      detail: "本地 stdio 服务会在下一轮启动第三方进程；远程服务会建立网络连接。工具调用仍经过 CodePilot 权限策略。",
      confirmLabel: "安装 MCP",
      tone: "danger",
      returnFocus: install
    });
    if (!confirmed) return;
    install.disabled = true;
    try {
      state.capabilities = await api("/api/mcp/install", {
        method: "POST",
        body: JSON.stringify({
          name: install.dataset.installMcp,
          version: install.dataset.version,
          sessionId: state.session?.id
        })
      });
      renderCapabilities();
      showRuntimeNotice(`已安装 MCP“${install.dataset.installMcp}”；将在下一轮能力快照中生效。`);
    } catch (error) {
      console.error(error);
      showRuntimeNotice(`MCP 安装失败：${error.message}`);
      install.disabled = false;
    }
    return;
  }
  const toggle = event.target.closest("[data-toggle-mcp]");
  if (toggle) {
    toggle.disabled = true;
    try {
      state.capabilities = await api(`/api/mcp/servers/${encodeURIComponent(toggle.dataset.toggleMcp)}`, {
        method: "PATCH",
        body: JSON.stringify({
          enabled: toggle.dataset.enabled !== "true",
          sessionId: state.session?.id
        })
      });
      renderCapabilities();
      showRuntimeNotice(`MCP 配置已保存；运行中的能力快照保持不变，下一轮生效。`);
    } catch (error) {
      console.error(error);
      showRuntimeNotice(`MCP 配置保存失败：${error.message}`);
      toggle.disabled = false;
    }
    return;
  }
  const uninstall = event.target.closest("[data-uninstall-mcp]");
  if (!uninstall) return;
  const name = uninstall.dataset.uninstallMcp;
  const confirmed = await confirmations.confirm({
    title: `卸载 MCP“${name}”？`,
    message: "这会从项目 MCP 配置中移除该服务。",
    detail: "当前正在运行的能力快照不会被中途改写；下一轮将不再连接此服务。",
    confirmLabel: "卸载 MCP",
    tone: "danger",
    returnFocus: uninstall
  });
  if (!confirmed) return;
  try {
    const query = state.session ? `?sessionId=${encodeURIComponent(state.session.id)}` : "";
    state.capabilities = await api(`/api/mcp/servers/${encodeURIComponent(name)}${query}`, { method: "DELETE" });
    renderCapabilities();
    showRuntimeNotice(`已卸载 MCP“${name}”；当前快照保持稳定。`);
  } catch (error) {
    console.error(error);
    showRuntimeNotice(`MCP 卸载失败：${error.message}`);
  }
});
elements.mcpTokenForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const productId = state.mcpTokenProductId;
  const token = elements.mcpTokenInput.value;
  if (!productId || !token) return;
  elements.mcpTokenSubmit.disabled = true;
  elements.mcpTokenError.hidden = true;
  try {
    state.capabilities = await api("/api/mcp/auth/token", {
      method: "POST",
      body: JSON.stringify({ productId, token, sessionId: state.session?.id })
    });
    closeMcpTokenDialog();
    renderCapabilities();
    showRuntimeNotice("MCP 凭据已加密保存；将在下一轮能力快照中生效。");
  } catch (error) {
    console.error(error);
    elements.mcpTokenError.textContent = "连接保存失败，请检查 Token 后重试。";
    elements.mcpTokenError.hidden = false;
    elements.mcpTokenInput.select();
  } finally {
    elements.mcpTokenInput.value = "";
    elements.mcpTokenSubmit.disabled = false;
  }
});
elements.mcpTokenCancel.addEventListener("click", closeMcpTokenDialog);
elements.mcpTokenClose.addEventListener("click", closeMcpTokenDialog);
elements.mcpTokenDialog.addEventListener("cancel", (event) => {
  event.preventDefault();
  closeMcpTokenDialog();
});
elements.eventLog.addEventListener("click", (event) => {
  if (event.target === elements.eventLog || event.target.closest("[data-close-event-log]")) hideEventLog();
});

function applyTheme(theme, { persist = true } = {}) {
  const selected = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = selected;
  if (persist) localStorage.setItem(themeStorageKey, selected);
  document.querySelectorAll('input[name="codepilot-theme"]').forEach((input) => {
    input.checked = input.value === selected;
  });
}

function archivedProjects() {
  if (state.project.projects.length) return state.project.projects;
  return [{ id: state.project.currentProjectId, name: "当前项目", archivedTasks: state.sessions.archived }];
}

function formatArchiveTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "时间未知" : new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit"
  }).format(date);
}

function renderArchivedSessions() {
  const groups = archivedProjects().map((project) => {
    const sessions = project.id === state.project.currentProjectId ? state.sessions.archived : (project.archivedTasks ?? []);
    if (!sessions.length) return "";
    const rows = sessions.map((session) => `<article class="archived-session-row" data-archived-session-id="${escapeHtml(session.id)}" data-archived-project-id="${escapeHtml(project.id)}"><div><strong>${escapeHtml(displayTaskTitle(session.title))}</strong><small>${escapeHtml(formatArchiveTime(session.updatedAt))}</small></div><div class="archived-session-actions"><button type="button" data-archive-action="restore">恢复</button><button class="archive-delete-button" type="button" data-archive-action="delete" aria-label="彻底删除 ${escapeHtml(displayTaskTitle(session.title))}">${icon("trash")}</button></div></article>`).join("");
    return `<section class="archived-project-group"><header><span aria-hidden="true">${icon("folder")}</span><strong>${escapeHtml(project.name)}</strong><small>${sessions.length} 个会话</small></header><div>${rows}</div></section>`;
  }).filter(Boolean).join("");
  elements.archivedSessionList.innerHTML = groups || `<div class="settings-empty"><span aria-hidden="true">${icon("message-square")}</span><strong>还没有已归档会话</strong><p>归档后的 Task 会集中显示在这里，不再占用项目与最近列表。</p></div>`;
}

function activityLevel(tokens, peak) {
  if (!tokens || !peak) return 0;
  return Math.max(1, Math.min(4, Math.ceil((tokens / peak) * 4)));
}

async function renderActivity() {
  elements.activityContent.innerHTML = '<p class="settings-loading">正在读取活动…</p>';
  try {
    const activity = await api("/api/activity");
    const cells = activity.days.map((day) => `<span class="activity-cell" data-level="${activityLevel(day.tokens, activity.peakDailyTokens)}" title="${escapeHtml(day.date)} · ${formatTokenCount(day.tokens)} tokens"></span>`).join("");
    elements.activityContent.innerHTML = `<div class="activity-stats"><div><strong>${formatTokenCount(activity.totalTokens)}</strong><span>累计 Token 数</span></div><div><strong>${formatTokenCount(activity.peakDailyTokens)}</strong><span>峰值 Token 数</span></div><div><strong>${activity.currentStreakDays} 天</strong><span>当前连续天数</span></div><div><strong>${activity.longestStreakDays} 天</strong><span>最长连续天数</span></div></div><section class="activity-chart"><header><strong>Token 活动</strong><span>最近 365 天</span></header><div class="activity-grid" role="img" aria-label="最近 365 天 Token 活动热力图">${cells}</div><footer><span>少</span><i data-level="0"></i><i data-level="1"></i><i data-level="2"></i><i data-level="3"></i><i data-level="4"></i><span>多</span></footer></section>`;
  } catch (error) {
    console.error(error);
    elements.activityContent.innerHTML = '<div class="settings-empty"><strong>活动读取失败</strong><p>本地 JSONL 保持不变，请稍后重新打开活动页。</p><button type="button" data-retry-activity>重新读取</button></div>';
  }
}

function selectWorkspaceSettingsView(view) {
  const selected = ["appearance", "activity", "archives"].includes(view) ? view : "appearance";
  elements.settingsNav.querySelectorAll("[data-settings-view]").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.settingsView === selected)));
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => { panel.hidden = panel.dataset.settingsPanel !== selected; });
  if (selected === "activity") renderActivity();
  if (selected === "archives") renderArchivedSessions();
}

function openWorkspaceSettings({ returnFocus = document.activeElement } = {}) {
  dialogReturnFocus = returnFocus;
  applyTheme(document.documentElement.dataset.theme, { persist: false });
  selectWorkspaceSettingsView("appearance");
  elements.settings.hidden = false;
  requestAnimationFrame(() => elements.settingsNav.querySelector('[aria-selected="true"]')?.focus());
}

function closeWorkspaceSettings() {
  elements.settings.hidden = true;
  dialogReturnFocus?.focus?.();
  dialogReturnFocus = null;
}

async function openModelSettings({ returnFocus = document.activeElement } = {}) {
  dialogReturnFocus = returnFocus;
  if (!Object.keys(state.providerCatalog).length) state.providerCatalog = await api("/api/providers/catalog");
  const config = await api("/api/config");
  state.modelConfig = config;
  renderUsage();
  elements.modelProvider.innerHTML = Object.entries(state.providerCatalog).map(([id, item]) => `<option value="${id}">${escapeHtml(item.label)}</option>`).join("");
  elements.modelProvider.value = state.providerCatalog[config.provider] ? config.provider : "anthropic";
  renderProviderFields(elements.modelProvider.value, config.baseUrl, config.model);
  elements.modelApiKey.value = "";
  const budgets = config.budgets ?? config.budgetPolicy ?? {};
  elements.budgetMaxTurns.value = String(budgets.maxTurns ?? 24);
  elements.budgetMaxRetries.value = String(budgets.maxRetries ?? 2);
  elements.budgetDeadlineMinutes.value = String(Math.max(1, Math.round((budgets.deadlineMs ?? 600_000) / 60_000)));
  elements.budgetMaxOutputTokens.value = String(budgets.maxOutputTokens ?? 8_192);
  elements.budgetCompactionOutputTokens.value = String(budgets.compactionOutputTokens ?? 1_000);
  const effective = config.budgetPolicy;
  elements.budgetEffectiveOutput.textContent = effective?.outputClamped
    ? `模型上限 ${formatTokenCount(effective.providerMaxOutputTokens)} · 实际 ${formatTokenCount(effective.maxOutputTokens)}`
    : `实际输出上限 ${formatTokenCount(effective?.maxOutputTokens ?? budgets.maxOutputTokens ?? 8_192)}`;
  elements.runtimeSettings.hidden = false;
  requestAnimationFrame(() => elements.modelProvider.focus());
}

function renderProviderFields(provider, selectedBaseUrl = "", selectedModel = "") {
  const config = state.providerCatalog[provider] ?? state.providerCatalog.anthropic;
  elements.modelBaseUrl.innerHTML = config.baseUrls.map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)} · ${escapeHtml(item.value || "本地")}</option>`).join("");
  elements.modelBaseUrl.value = config.baseUrls.some((item) => item.value === selectedBaseUrl) ? selectedBaseUrl : config.baseUrls[0]?.value ?? "";
  elements.modelName.innerHTML = config.models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
  elements.modelName.value = config.models.includes(selectedModel) ? selectedModel : config.models[0] ?? "";
  const hasCredential = provider === state.modelConfig?.provider
    ? state.modelConfig?.hasApiKey
    : state.modelConfig?.configuredProviders?.includes(provider);
  elements.modelApiKey.placeholder = hasCredential
    ? "该 Provider 已配置（留空保持不变）"
    : "该 Provider 尚未配置 API Key";
  elements.clearApiKey.checked = false;
}

async function refreshProviderModels() {
  const result = await api("/api/providers/models", {
    method: "POST",
    body: JSON.stringify({ provider: elements.modelProvider.value, baseUrl: elements.modelBaseUrl.value, apiKey: elements.modelApiKey.value })
  });
  const current = elements.modelName.value;
  elements.modelName.innerHTML = result.models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
  elements.modelName.value = result.models.includes(current) ? current : result.models[0] ?? "";
}

function closeModelSettings() {
  elements.runtimeSettings.hidden = true;
  dialogReturnFocus?.focus?.();
  dialogReturnFocus = null;
}

document.querySelector("#model-settings").addEventListener("click", () => openModelSettings().catch(console.error));
document.querySelector("#sidebar-settings").addEventListener("click", () => openWorkspaceSettings({ returnFocus: sidebarMedia.matches ? elements.sidebarToggle : document.querySelector("#sidebar-settings") }));
document.querySelector("#close-settings").addEventListener("click", closeModelSettings);
document.querySelector("#cancel-settings").addEventListener("click", closeModelSettings);
elements.runtimeSettings.addEventListener("click", (event) => {
  if (event.target === elements.runtimeSettings) closeModelSettings();
});
elements.workspaceSettingsClose.addEventListener("click", closeWorkspaceSettings);
elements.settings.addEventListener("click", (event) => { if (event.target === elements.settings) closeWorkspaceSettings(); });
elements.settingsNav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-settings-view]");
  if (button) selectWorkspaceSettingsView(button.dataset.settingsView);
});
document.querySelectorAll('input[name="codepilot-theme"]').forEach((input) => input.addEventListener("change", () => applyTheme(input.value)));
elements.activityContent.addEventListener("click", (event) => { if (event.target.closest("[data-retry-activity]")) renderActivity(); });
elements.archivedSessionList.addEventListener("click", async (event) => {
  const action = event.target.closest("[data-archive-action]")?.dataset.archiveAction;
  const row = event.target.closest("[data-archived-session-id]");
  if (!action || !row) return;
  const sessionId = row.dataset.archivedSessionId;
  const projectId = row.dataset.archivedProjectId;
  const title = row.querySelector("strong")?.textContent ?? "已归档会话";
  if (action === "delete") {
    const confirmed = await confirmations.confirm({
      title: "彻底删除这个会话？",
      message: "本地 JSONL 和派生记录会被删除，活动统计也会随之更新。",
      detail: title,
      detailMeta: "删除后不可撤销",
      confirmLabel: "彻底删除",
      tone: "danger",
      returnFocus: event.target.closest("button")
    });
    if (!confirmed) return;
  }
  try {
    if (window.codepilotDesktop?.restoreArchivedSession) {
      const navigation = action === "restore"
        ? await window.codepilotDesktop.restoreArchivedSession(projectId, sessionId)
        : await window.codepilotDesktop.deleteArchivedSession(projectId, sessionId);
      state.project = { ...state.project, ...navigation };
      if (projectId === state.project.currentProjectId) await refreshSessions();
    } else {
      await api(action === "restore" ? `/api/sessions/${sessionId}/restore` : `/api/sessions/${sessionId}`, { method: action === "restore" ? "POST" : "DELETE" });
      await refreshSessions();
    }
    if (action === "delete" && state.session?.id === sessionId) {
      state.session = null;
      state.events = [];
      render();
    }
    renderArchivedSessions();
  } catch (error) {
    console.error(error);
    showRuntimeNotice(action === "restore" ? "恢复会话失败，本地归档保持不变。" : "删除会话失败，本地记录保持不变。");
  }
});
elements.modelProvider.addEventListener("change", () => {
  elements.modelApiKey.value = "";
  renderProviderFields(elements.modelProvider.value);
});
document.querySelector("#refresh-models").addEventListener("click", () => refreshProviderModels().catch(console.error));
elements.modelForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = elements.modelForm.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    state.modelConfig = await api("/api/config", { method: "POST", body: JSON.stringify({
      provider: elements.modelProvider.value,
      baseUrl: elements.modelBaseUrl.value,
      model: elements.modelName.value,
      apiKey: elements.modelApiKey.value,
      clearApiKey: elements.clearApiKey.checked,
      budgets: {
        maxTurns: Number(elements.budgetMaxTurns.value),
        maxRetries: Number(elements.budgetMaxRetries.value),
        deadlineMs: Number(elements.budgetDeadlineMinutes.value) * 60_000,
        maxOutputTokens: Number(elements.budgetMaxOutputTokens.value),
        compactionOutputTokens: Number(elements.budgetCompactionOutputTokens.value)
      }
    }) });
    renderQuickModelSettings();
    renderUsage();
    closeModelSettings();
  } catch (error) {
    console.error(error);
    showRuntimeNotice("模型配置保存失败，请检查配置后重试。");
  } finally {
    submit.disabled = false;
  }
});

window.addEventListener("pagehide", () => {
  if (!state.running || !state.session) return;
  navigator.sendBeacon(`/api/sessions/${state.session.id}/disconnect`, new Blob(["{}"], { type: "application/json" }));
});

document.addEventListener("keydown", (event) => {
  const inspectorLayer = state.inspectorLayout.compact && state.inspectorLayout.open ? elements.inspector : null;
  const activeLayer = [elements.permission, elements.settings, elements.runtimeSettings, elements.eventLog, elements.skillDetailLayer, inspectorLayer].find((layer) => layer && !layer.hidden);
  if (event.key === "Tab" && activeLayer) {
    const focusable = [...activeLayer.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null);
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
  if (event.key !== "Escape") return;
  if (!elements.settings.hidden) closeWorkspaceSettings();
  else if (!elements.runtimeSettings.hidden) closeModelSettings();
  else if (!elements.eventLog.hidden) hideEventLog();
  else if (!elements.skillDetailLayer.hidden) closeSkillDetail();
  else if (!elements.skillsLayer.hidden) closeSkillsView();
  else if (!elements.mcpLayer.hidden) closeMcpView();
  else if (state.inspectorLayout.compact && state.inspectorLayout.open) updateInspectorOpen(false, { moveFocus: true });
  else if (state.sidebarOpen) setSidebarOpen(false);
  else if (document.querySelector(".project-menu:not([hidden])")) closeProjectMenus({ restoreFocus: true });
  else document.querySelectorAll(".session-menu").forEach((menu) => { menu.hidden = true; });
});

function consumeStartupNavigationIntent() {
  const url = new URL(window.location.href);
  const newTask = url.searchParams.get("newTask") === "1";
  const candidateSessionId = url.searchParams.get("session") ?? "";
  const sessionId = /^[a-z0-9-]+$/i.test(candidateSessionId) ? candidateSessionId : null;
  if (newTask || candidateSessionId) {
    url.searchParams.delete("newTask");
    url.searchParams.delete("session");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }
  return { newTask, sessionId };
}

async function bootstrap() {
  renderInspectorLayout();
  renderSidebarDrawer();
  const navigationIntent = consumeStartupNavigationIntent();
  await loadCurrentProjectRuntime(navigationIntent);
}

bootstrap().catch((error) => {
  console.error(error);
  showRuntimeNotice("CodePilot 初始化失败，请确认本地服务正在运行后刷新页面。");
});
resizeTaskInput();
syncRunAction();
