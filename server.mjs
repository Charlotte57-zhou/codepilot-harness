import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { appendEvent, archiveSession, createSession, deleteSession, getEvents, getEventsSince, listSessions, projectActivity, renameSession, renameSessionFromModel, restoreSession } from "./src/session-store.mjs";
import { readJsonBody } from "./src/http-body.mjs";
import { CapabilityManager, setSkillEnabled, uninstallSkill } from "./src/capability-manager.mjs";
import { loadSkillCatalog } from "./src/skill-catalog.mjs";
import { loadMcpCatalog, projectMcpCatalog } from "./src/mcp-catalog.mjs";
import {
  installRegistryMcp,
  resolveOfficialMcpServer,
  searchOfficialMcpRegistry,
  setMcpEnabled,
  uninstallMcp
} from "./src/mcp-marketplace.mjs";
import { getFeaturedMcpProducts } from "./src/mcp-curation.mjs";
import { McpAuthenticationManager } from "./src/mcp-auth-manager.mjs";
import { modelCapabilitiesFromEnvironment } from "./src/model-capabilities.mjs";
import { ProviderAuxiliaryClient } from "./src/provider-auxiliary-client.mjs";
import { getModelEnvironment, getPublicModelConfig, initializeModelRuntimeConfig, reloadModelRuntimeConfig, resetModelConfig, updateModelConfig } from "./src/model-runtime-config.mjs";
import { resolveRunBudgetPolicy } from "./src/runtime-budget-policy.mjs";
import { providerCatalog, publicProviderCatalog } from "./src/provider-catalog.mjs";
import { RunSupervisor } from "./src/run-supervisor.mjs";
import { createCodePilotToolRegistry } from "./src/tools/codepilot-tool-registry.mjs";
import { recoverSessionTranscript } from "./src/session-recovery.mjs";
import { classifyModelError } from "./src/model-retry.mjs";
import { attachmentLimits, attachmentMetadata, normalizeAttachmentRecord } from "./src/attachment-protocol.mjs";
import { ExecutionBroker } from "./src/execution-broker.mjs";
import { AutomationArtifactStore } from "./src/automation-artifact-store.mjs";
import { BrowserRuntime } from "./src/browser-runtime.mjs";
import { BrowserSessionStore } from "./src/browser-session-store.mjs";
import { ComputerRuntime } from "./src/computer-runtime.mjs";
import { InteractionSessionManager } from "./src/interaction-session-manager.mjs";
import { createAutomationTools } from "./src/tools/automation-tools.mjs";
import { revertRunFileChanges } from "./src/file-change-service.mjs";
import { createRuntimeOptions } from "./src/runtime-options.mjs";
import { createDeliveryContract } from "./src/delivery-contract.mjs";
import { createProviderVisualReviewer } from "./src/provider-visual-reviewer.mjs";
import { ClaudeAgentRuntime } from "./src/claude-agent-runtime.mjs";
import { createCodePilotSdkMcpServer } from "./src/sdk-tool-bridge.mjs";
import { resolveAnthropicProviderProfile } from "./src/anthropic-provider-profile.mjs";
import { createWorkspacePreviewServer } from "./src/workspace-preview-server.mjs";
import { AnthropicOpenAiGateway } from "./src/anthropic-openai-gateway.mjs";
import { selectCompletedSdkSession } from "./src/sdk-session-resume.mjs";
import { getProviderCredential } from "./src/provider-credential-vault.mjs";
import { loadProjectMemory } from "./src/project-memory.mjs";
import { loadProjectRules } from "./src/project-rules.mjs";
import { isWorkspaceTargetId, workspaceTargetIdForPath } from "./src/workspace-target-identity.mjs";

const port = Number(process.env.PORT ?? 4173);
const publicDir = join(process.cwd(), "public");
const workspaceRoot = resolve(process.env.CODEPILOT_WORKSPACE_ROOT ?? join(process.cwd(), "demo-repo"));
const projectId = process.env.CODEPILOT_PROJECT_ID ?? "project-demo";
const projectName = process.env.CODEPILOT_PROJECT_NAME ?? basename(workspaceRoot);
const workspaceTargetId = isWorkspaceTargetId(process.env.CODEPILOT_WORKSPACE_TARGET_ID)
  ? process.env.CODEPILOT_WORKSPACE_TARGET_ID
  : workspaceTargetIdForPath(workspaceRoot);
const mainWorkspaceTargetId = isWorkspaceTargetId(process.env.CODEPILOT_PROJECT_MAIN_TARGET_ID)
  ? process.env.CODEPILOT_PROJECT_MAIN_TARGET_ID
  : workspaceTargetId;
const runtimeControlToken = process.env.CODEPILOT_RUNTIME_CONTROL_TOKEN ?? "";
const workspacePreview = createWorkspacePreviewServer({
  workspaceRoot,
  port: Number(process.env.CODEPILOT_PREVIEW_PORT ?? 0)
});
const mcpAuthManager = new McpAuthenticationManager({ workspaceRoot });
const automationArtifacts = new AutomationArtifactStore({ workspaceRoot });
const browserSessionStore = new BrowserSessionStore({ workspaceRoot });
const browserRuntime = new BrowserRuntime({ artifactStore: automationArtifacts, sessionStore: browserSessionStore });
const computerRuntime = new ComputerRuntime({ artifactStore: automationArtifacts });
const interactionManager = new InteractionSessionManager({ browserRuntime, computerRuntime });
const runSupervisor = new RunSupervisor({ appendEvent });
const executionBroker = new ExecutionBroker({ appendEvent });
const claudeAgentRuntime = new ClaudeAgentRuntime();
const anthropicOpenAiGateway = new AnthropicOpenAiGateway();
const automationTools = createAutomationTools({ interactionManager });
const toolRegistry = createCodePilotToolRegistry({ additionalTools: automationTools });
const capabilityManager = new CapabilityManager({
  workspaceRoot,
  baseToolRegistry: toolRegistry,
  authManager: mcpAuthManager
});
const pendingPermissions = new Map();
const interactiveLeases = new Map();
const interactiveLeaseMs = 15_000;
const hookPhases = ["SessionStart", "PreToolUse", "PermissionRequest", "PostToolUse", "Stop"];

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function displayWorkspacePath(path) {
  const home = homedir();
  const fromHome = relative(home, path);
  if (fromHome === "") return "~";
  if (fromHome && !fromHome.startsWith("..") && !isAbsolute(fromHome)) return join("~", fromHome);
  return path;
}

function publicProjectConfig() {
  return {
    id: projectId,
    name: projectName,
    workspaceTargetId,
    mainWorkspaceTargetId,
    displayPath: displayWorkspacePath(workspaceRoot),
    running: runSupervisor.hasAnyActive()
  };
}

function publicRuntimeConfig() {
  const config = getPublicModelConfig();
  const capabilities = modelCapabilitiesFromEnvironment(getModelEnvironment());
  return {
    ...config,
    effectiveReasoning: {
      ...config.effectiveReasoning,
      enabled: capabilities.reasoning && config.thinkingEnabled
    },
    capabilities,
    budgetPolicy: resolveRunBudgetPolicy(config.budgets, capabilities),
    previewOrigin: workspacePreview.origin
  };
}

function normalizePermissionMode(value) {
  return ["ask", "auto", "full"].includes(value) ? value : "ask";
}

function normalizeAttachments(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > attachmentLimits.maxFiles) throw new Error(`attachments must contain at most ${attachmentLimits.maxFiles} files`);
  const attachments = value.map((item) => normalizeAttachmentRecord({ ...item, id: randomUUID(), origin: "upload" }));
  if (attachments.some((attachment) => !attachment)) throw new Error("each attachment must be a supported text file, image, or PDF");
  for (const attachment of attachments) {
    if (attachment.name.length > 255) throw new Error("attachment file names must be under 255 characters");
    if (attachment.kind === "text" && attachment.charCount > attachmentLimits.maxTextCharsPerFile) throw new Error("each text attachment must be under 200,000 characters");
    if (attachment.kind === "image" && attachment.byteSize > attachmentLimits.maxImageBytesPerFile) throw new Error("each image attachment must be under 2 MB");
    if (attachment.kind === "pdf" && attachment.byteSize > attachmentLimits.maxPdfBytesPerFile) throw new Error("each PDF attachment must be under 4 MB");
  }
  const totalBytes = attachments.reduce((total, attachment) => total + attachment.byteSize, 0);
  if (totalBytes > attachmentLimits.maxTotalBytes) throw new Error("attachments exceed the 6 MB total limit");
  return attachments;
}

function latestRunPreferences(events = []) {
  const preference = [...events].reverse().find((event) => event.type === "run_preferences_selected")?.data;
  return { permissionMode: normalizePermissionMode(preference?.permissionMode) };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request, options) {
  return readJsonBody(request, options);
}

function createPermissionRequester(sessionId, runId) {
  return async (request) => {
    const requestId = randomUUID();
    await appendEvent(sessionId, "permission_requested", { requestId, ...request, runId });
    return new Promise((resolve) => pendingPermissions.set(requestId, { sessionId, tool: request.tool, runId, resolve }));
  };
}

function cancellation(reason, message) {
  const code = reason === "interactive_session_lost" || reason === "browser_disconnected" || reason === "heartbeat_timeout"
    ? "INTERACTIVE_SESSION_LOST"
    : "USER_STOP";
  return { kind: "cancelled", reason, code, message };
}

async function cancelActiveRun(sessionId, cancellationReason) {
  interactiveLeases.delete(sessionId);
  const activeRun = runSupervisor.activeRun(sessionId);
  if (!activeRun) return false;
  await runSupervisor.cancelSession(sessionId, cancellationReason);
  for (const [requestId, pending] of pendingPermissions) {
    if (pending.sessionId !== sessionId) continue;
    pendingPermissions.delete(requestId);
    pending.resolve(cancellationReason);
  }
  await appendEvent(sessionId, "agent_cancel_requested", { ...cancellationReason, runId: activeRun.runId });
  return true;
}

async function endInteractiveSession(sessionId, reason) {
  interactiveLeases.delete(sessionId);
  const activeRun = runSupervisor.activeRun(sessionId);
  if (!activeRun) return;
  // Renderer presence is not run ownership. Reloading or switching windows must
  // not kill a server-owned complex task or invalidate its permission request.
  await appendEvent(sessionId, "interactive_session_detached", { reason, runId: activeRun.runId });
}

setInterval(() => {
  const now = Date.now();
  for (const [sessionId, lastSeen] of interactiveLeases) {
    if (now - lastSeen > interactiveLeaseMs) endInteractiveSession(sessionId, "heartbeat_timeout").catch(() => {});
  }
}, 5_000).unref();

function cleanSessionTitle(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*["'`#*-]+|["'`#*]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 44);
}

function publicModelFailure(error) {
  const classification = classifyModelError(error);
  return {
    message: classification.message,
    category: classification.category,
    status: classification.status,
    networkReason: classification.networkReason,
    diagnosticCode: classification.diagnosticCode
  };
}

async function capabilityView(sessionId) {
  const [skillCatalog, mcpCatalog, authStates] = await Promise.all([
    loadSkillCatalog(workspaceRoot),
    loadMcpCatalog(workspaceRoot),
    mcpAuthManager.getPublicStates()
  ]);
  const skills = skillCatalog.skills;
  const events = sessionId ? await getEvents(sessionId) : [];
  const latestSnapshot = [...events].reverse().find((event) => event.type === "capability_snapshot_created");
  const activeSkills = latestSnapshot ? new Set(latestSnapshot.data?.skills ?? []) : undefined;
  const latestSkillStages = new Map();
  for (const event of events) {
    if (event.type === "skill_lifecycle_changed" && event.data?.skill) latestSkillStages.set(event.data.skill, event.data);
  }
  const mcp = projectMcpCatalog(mcpCatalog, events);
  const nativeCapabilities = [
    {
      id: "workspace",
      title: "工作区",
      description: "读取、搜索与受控修改项目文件",
      tools: ["ListFiles", "Read", "Search", "CreateDirectory", "Edit", "Write", "Delete"]
    },
    {
      id: "terminal",
      title: "终端",
      description: "在权限策略与工作区边界内执行命令",
      tools: ["Bash"]
    },
    {
      id: "delegation",
      title: "子 Agent",
      description: "隔离研究支线、预算和工具范围",
      tools: ["Agent"]
    },
    {
      id: "skills",
      title: "技能",
      description: "按需加载项目工作流与专业方法",
      tools: ["Skill"]
    },
    {
      id: "browser",
      title: "浏览器",
      description: "管理隔离浏览器，或附加本机 Chrome 调试会话",
      tools: automationTools.filter((tool) => tool.name.startsWith("Browser")).map((tool) => tool.name)
    },
    {
      id: "computer",
      title: "桌面控制",
      description: "通过 Windows UI Automation、截图和输入控制桌面窗口",
      tools: automationTools.filter((tool) => tool.name.startsWith("Computer")).map((tool) => tool.name)
    }
  ];
  return {
    builtInTools: toolRegistry.list().map((tool) => ({ name: tool.name, description: tool.description })),
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      displayName: skill.displayName,
      whenToUse: skill.whenToUse,
      executionContext: skill.executionContext,
      argumentHint: skill.argumentHint,
      argumentNames: skill.argumentNames,
      allowedTools: skill.allowedTools,
      modelInvocable: skill.modelInvocable,
      userInvocable: skill.userInvocable,
      paths: skill.paths,
      source: skill.source,
      trust: skill.trust,
      installation: skill.installation,
      path: skill.path,
      format: skill.format,
      contentLength: skill.contentLength,
      truncated: skill.truncated,
      enabled: skill.enabled,
      activeInCurrentSnapshot: activeSkills ? activeSkills.has(skill.name) : null,
      lifecycle: latestSkillStages.get(skill.name) ?? null
    })),
    skillDiagnostics: skillCatalog.diagnostics,
    mcp: { ...mcp, nativeCapabilities, featuredProducts: getFeaturedMcpProducts(), authStates },
    automation: {
      browserSessionCount: interactionManager.browser.listSessions().length,
      computerSessionCount: interactionManager.computer.listSessions().length
    },
    hooks: hookPhases,
    snapshotId: latestSnapshot?.data?.snapshotId ?? null,
    snapshotTurn: latestSnapshot?.data?.turn ?? null,
    running: Boolean(sessionId && runSupervisor.hasActive(sessionId))
  };
}

function fallbackSessionTitle(task) {
  return cleanSessionTitle(task.replace(/\s+/g, " ").replace(/[。！？!?].*$/, "")) || "新建对话";
}

async function runTextAgent(sessionId, task, shouldRename, signal, runId, runPreferences = {}) {
  // The request boundary owns model selection. A queued run must not observe a
  // later settings change, just as it must not observe a later budget change.
  const modelEnvironment = runPreferences.modelEnvironment ?? getModelEnvironment();
  const publicModel = runPreferences.runtimeSnapshot ?? publicRuntimeConfig();
  const providerProfile = resolveAnthropicProviderProfile({
    provider: publicModel.provider,
    baseUrl: publicModel.baseUrl,
    model: publicModel.model,
    apiKey: modelEnvironment.MODEL_API_KEY
  });
  let sdkProviderProfile = providerProfile;
  let releaseProviderRoute = () => {};
  if (providerProfile.transport === "openai-adapter") {
    const route = anthropicOpenAiGateway.register({
      baseUrl: providerProfile.baseUrl,
      apiKey: providerProfile.apiKey,
      model: providerProfile.model,
      onEvent: (transport) => appendEvent(sessionId, "provider_transport_state_changed", {
        ...transport,
        provider: providerProfile.id,
        model: providerProfile.model,
        runId
      })
    });
    releaseProviderRoute = route.release;
    sdkProviderProfile = Object.freeze({
      ...providerProfile,
      baseUrl: route.baseUrl,
      auxiliaryMessagesBaseUrl: `${route.baseUrl}/v1`,
      apiKey: route.apiKey,
      authMode: "api_key"
    });
  }
  const modelCapabilities = modelCapabilitiesFromEnvironment(modelEnvironment);
  const sdkVisionClient = modelCapabilities.input?.image
    ? new ProviderAuxiliaryClient({
        apiKey: sdkProviderProfile.apiKey,
        baseUrl: sdkProviderProfile.auxiliaryMessagesBaseUrl,
        model: sdkProviderProfile.model,
        authMode: sdkProviderProfile.authMode,
        timeoutMs: Number(modelEnvironment.MODEL_TIMEOUT_MS ?? 60_000),
        capabilities: modelCapabilities
      })
    : null;
  const budgetPolicy = runPreferences.budgetPolicy
    ?? resolveRunBudgetPolicy(publicModel.budgets, modelCapabilities);
  const deliveryContract = createDeliveryContract({
    task,
    capabilities: modelCapabilities,
    browserToolsAvailable: ["PreviewArtifact", "BrowserNavigate", "BrowserInspect", "BrowserScreenshot", "BrowserClick"]
      .every((toolName) => Boolean(toolRegistry.get(toolName)))
  });
  const runtimeOptions = createRuntimeOptions({
    runId,
    workspaceRoot,
    settingSources: ["project"],
    permissionMode: normalizePermissionMode(runPreferences.permissionMode),
    budgets: budgetPolicy,
    deliveryContract,
    model: {
      provider: providerProfile.id,
      name: providerProfile.model,
      capabilities: modelCapabilities,
      reasoning: {
        enabled: publicModel.effectiveReasoning?.enabled === true,
        effort: publicModel.effectiveReasoning?.effort,
        supportedEfforts: publicModel.effectiveReasoning?.efforts ?? [],
        thinkingMode: publicModel.effectiveReasoning?.thinkingMode ?? "none",
        budgetTokens: publicModel.effectiveReasoning?.budgetTokens ?? null
      }
    }
  });
  const [projectRules, projectMemory] = await Promise.all([
    loadProjectRules(workspaceRoot),
    loadProjectMemory(workspaceRoot)
  ]);
  await appendEvent(sessionId, "runtime_options_frozen", runtimeOptions);
  const capabilitySnapshot = await capabilityManager.refresh({ task });
  await appendEvent(sessionId, "capability_snapshot_created", {
    snapshotId: capabilitySnapshot.id,
    tools: capabilitySnapshot.toolDefinitions.map((tool) => tool.name),
    skills: capabilitySnapshot.skills.map((skill) => skill.name),
    mcpServers: capabilitySnapshot.mcpServers,
    runId
  });
  const extensionRuntimeState = {};
  const extensionToolContext = (toolName, extra) => ({
    workspaceRoot,
    workspacePreviewOrigin: workspacePreview.origin,
    signal,
    sessionId,
    runId,
    toolCallId: extra?.toolUseId ?? extra?.tool_use_id ?? `${toolName}-${randomUUID()}`,
    executionBroker,
    runtimeState: extensionRuntimeState,
    recordAutomationEvent: (type, data) => appendEvent(sessionId, type, { ...data, runId }),
    recordSkillLifecycle: (data) => appendEvent(sessionId, "skill_lifecycle_changed", { ...data, runId })
  });
  const codePilotMcpServer = createCodePilotSdkMcpServer({
    toolRegistry: capabilitySnapshot.toolRegistry,
    contextFactory: extensionToolContext
  });
  const sdkAgents = Object.fromEntries(capabilitySnapshot.skills
    .filter((skill) => skill.executionContext === "fork")
    .map((skill) => [skill.name, {
      description: skill.description,
      prompt: [
        `You are executing the CodePilot Skill ${skill.displayName}.`,
        `Source: ${skill.path}`,
        skill.instructions
      ].join("\n\n"),
      tools: skill.allowedTools?.filter((name) => name !== "Skill"),
      model: skill.model || undefined,
      maxTurns: skill.maxTurns
    }]));
  const events = await getEvents(sessionId);
  const priorSdkSession = selectCompletedSdkSession(events, providerProfile.id);
  try {
    return await claudeAgentRuntime.run({
    sessionId,
    runId,
    task,
    workspaceRoot,
    provider: providerProfile.id,
    providerProfile: sdkProviderProfile,
    model: providerProfile.model,
    reasoning: runtimeOptions.model.reasoning,
    apiKey: providerProfile.apiKey,
    baseUrl: providerProfile.baseUrl,
    signal,
    permissionMode: normalizePermissionMode(runPreferences.permissionMode),
    budgetPolicy,
    settingSources: runtimeOptions.settingSources,
    resume: priorSdkSession,
    requestApproval: createPermissionRequester(sessionId, runId),
    appendEvent,
    deliveryContract,
    browserRuntime,
    workspacePreviewOrigin: workspacePreview.origin,
    visualReviewer: createProviderVisualReviewer({ modelClient: sdkVisionClient, artifactStore: automationArtifacts }),
    mcpServers: { codepilot: codePilotMcpServer },
    extensionToolRegistry: capabilitySnapshot.toolRegistry,
    extensionToolContext,
    additionalSystemContext: [
      projectRules.content ? `# CodePilot Project Rules\n${projectRules.content}` : "",
      projectMemory.content ? `# CodePilot Project Memory\n${projectMemory.content}` : ""
    ].filter(Boolean).join("\n\n"),
    agents: sdkAgents,
    beforeFinal: async () => {
      if (shouldRename) await renameSessionFromModel(sessionId, fallbackSessionTitle(task), { runId });
    }
    });
  } finally {
    releaseProviderRoute();
  }
}

async function fetchProviderModels(input = {}) {
  const provider = input.provider || process.env.MODEL_PROVIDER || "anthropic";
  const catalog = providerCatalog[provider] ?? providerCatalog.anthropic;
  // Model discovery uses the credential owned by the requested Provider. The
  // active run credential must never bleed into a different Provider preview.
  const apiKey = input.apiKey || getProviderCredential(provider);
  const fallback = { models: catalog.models, source: "verified-anthropic-profile", warning: catalog.modelsEndpoint ? "输入 API Key 后可刷新 Anthropic 官方模型列表。" : "该 Anthropic-compatible Coding endpoint 使用内置已核验模型列表。" };
  if (!apiKey || !catalog.modelsEndpoint) return fallback;

  try {
    const headers = catalog.authMode === "bearer"
      ? { authorization: `Bearer ${apiKey}` }
      : { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    const response = await fetch(catalog.modelsEndpoint, { headers });
    if (!response.ok) return { ...fallback, warning: "该官方端点暂不返回模型列表，已使用内置官方模型选项。" };
    const payload = await response.json();
    const models = Array.isArray(payload.data) ? payload.data.map((item) => item.id).filter(Boolean) : [];
    return models.length ? { models, source: "provider-api" } : fallback;
  } catch {
    return { ...fallback, warning: "模型列表刷新失败，已使用内置官方模型选项。" };
  }
}

async function serveStatic(request, response) {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;
  const requestedPath = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^([/\\])+/, "");
  const filePath = resolve(publicDir, requestedPath);
  const relativePath = relative(publicDir, filePath);

  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const file = await readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
      "cache-control": "no-store, max-age=0"
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const segments = url.pathname.split("/").filter(Boolean);

    if (request.method === "GET" && url.pathname === "/api/sessions") {
      const active = await listSessions(false);
      const projectSession = (session) => session.workspaceTargetId || !mainWorkspaceTargetId
        ? session
        : { ...session, workspaceTargetId: mainWorkspaceTargetId };
      return sendJson(response, 200, {
        active: active.map((session) => ({
          ...projectSession(session),
          running: runSupervisor.hasActive(session.id) && !["completed", "failed", "cancelled"].includes(session.latestRunState)
        })),
        archived: (await listSessions(true)).map(projectSession)
      });
    }

    if (request.method === "GET" && url.pathname === "/api/activity") {
      return sendJson(response, 200, await projectActivity());
    }

    if (request.method === "GET" && url.pathname === "/api/project") {
      return sendJson(response, 200, publicProjectConfig());
    }

    if (request.method === "POST" && url.pathname === "/api/internal/reload-model-config") {
      if (!runtimeControlToken || request.headers["x-codepilot-runtime-control"] !== runtimeControlToken) {
        response.writeHead(404);
        response.end("Not found");
        return;
      }
      await reloadModelRuntimeConfig();
      return sendJson(response, 200, { reloaded: true });
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return sendJson(response, 200, publicRuntimeConfig());
    }

    if (request.method === "GET" && url.pathname === "/api/providers/catalog") {
      return sendJson(response, 200, publicProviderCatalog());
    }

    if (request.method === "GET" && url.pathname === "/api/capabilities") {
      return sendJson(response, 200, await capabilityView(url.searchParams.get("sessionId")));
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "automation" && segments[2] === "artifacts" && segments[3]) {
      const artifact = await automationArtifacts.read(decodeURIComponent(segments[3]));
      response.writeHead(200, {
        "content-type": artifact.contentType,
        "content-length": artifact.size,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      });
      response.end(artifact.buffer);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/mcp/auth/oauth/start") {
      const body = await readRequestBody(request);
      if (typeof body.productId !== "string" || !body.productId.trim()) {
        return sendJson(response, 400, { error: "productId must be a non-empty string" });
      }
      return sendJson(response, 202, await mcpAuthManager.beginOAuth(body.productId.trim()));
    }

    if (request.method === "POST" && url.pathname === "/api/mcp/auth/token") {
      const body = await readRequestBody(request);
      if (typeof body.productId !== "string" || typeof body.token !== "string") {
        return sendJson(response, 400, { error: "productId and token are required" });
      }
      await mcpAuthManager.storeBearerToken(body.productId.trim(), body.token);
      return sendJson(response, 201, await capabilityView(body.sessionId));
    }

    if (request.method === "GET" && url.pathname === "/api/mcp/auth/status") {
      const productId = url.searchParams.get("productId");
      if (!productId) return sendJson(response, 400, { error: "productId is required" });
      const state = await mcpAuthManager.getPublicState(productId);
      return sendJson(response, 200, {
        state,
        ...(state.status === "authorized"
          ? { capabilities: await capabilityView(url.searchParams.get("sessionId")) }
          : {})
      });
    }

    if (request.method === "DELETE" && segments[0] === "api" && segments[1] === "mcp" && segments[2] === "auth" && segments[3]) {
      await mcpAuthManager.disconnect(decodeURIComponent(segments[3]));
      return sendJson(response, 200, await capabilityView(url.searchParams.get("sessionId")));
    }

    if (request.method === "GET" && url.pathname === "/api/mcp/registry") {
      const result = await searchOfficialMcpRegistry({
        query: url.searchParams.get("query") ?? "",
        limit: url.searchParams.get("limit") ?? 24,
        cursor: url.searchParams.get("cursor") || undefined
      });
      return sendJson(response, 200, result);
    }

    if (request.method === "POST" && url.pathname === "/api/mcp/install") {
      const body = await readRequestBody(request);
      if (typeof body.name !== "string" || !body.name.trim()) return sendJson(response, 400, { error: "name must be a non-empty string" });
      const registryServer = await resolveOfficialMcpServer(body.name.trim(), body.version);
      await installRegistryMcp(workspaceRoot, registryServer);
      return sendJson(response, 201, await capabilityView(body.sessionId));
    }

    if (segments[0] === "api" && segments[1] === "mcp" && segments[2] === "servers" && segments[3]) {
      const name = decodeURIComponent(segments[3]);
      if (request.method === "PATCH") {
        const body = await readRequestBody(request);
        if (typeof body.enabled !== "boolean") return sendJson(response, 400, { error: "enabled must be a boolean" });
        await setMcpEnabled(workspaceRoot, name, body.enabled);
        return sendJson(response, 200, await capabilityView(body.sessionId));
      }
      if (request.method === "DELETE") {
        await uninstallMcp(workspaceRoot, name);
        return sendJson(response, 200, await capabilityView(url.searchParams.get("sessionId")));
      }
    }

    if (request.method === "PATCH" && segments[0] === "api" && segments[1] === "capabilities" && segments[2] === "skills" && segments[3]) {
      const body = await readRequestBody(request, { maxBytes: 8_500_000 });
      if (typeof body.enabled !== "boolean") return sendJson(response, 400, { error: "enabled must be a boolean" });
      await setSkillEnabled(workspaceRoot, decodeURIComponent(segments[3]), body.enabled);
      return sendJson(response, 200, await capabilityView(body.sessionId));
    }

    if (request.method === "DELETE" && segments[0] === "api" && segments[1] === "capabilities" && segments[2] === "skills" && segments[3]) {
      await uninstallSkill(workspaceRoot, decodeURIComponent(segments[3]));
      return sendJson(response, 200, await capabilityView(url.searchParams.get("sessionId")));
    }

    if (request.method === "POST" && url.pathname === "/api/providers/models") {
      const body = await readRequestBody(request);
      return sendJson(response, 200, await fetchProviderModels(body));
    }

    if (request.method === "POST" && url.pathname === "/api/config") {
      const body = await readRequestBody(request);
      await updateModelConfig(body);
      return sendJson(response, 200, publicRuntimeConfig());
    }

    if (request.method === "POST" && url.pathname === "/api/config/reset") {
      await resetModelConfig();
      return sendJson(response, 200, publicRuntimeConfig());
    }

    if (request.method === "POST" && url.pathname === "/api/sessions") {
      const body = await readRequestBody(request);
      const session = await createSession(body.title ?? "Untitled session", { workspaceTargetId });
      return sendJson(response, 201, session);
    }

    if (request.method === "PATCH" && segments[0] === "api" && segments[1] === "sessions" && segments.length === 3) {
      const body = await readRequestBody(request);
      return sendJson(response, 200, await renameSession(segments[2], body.title, { source: "user" }));
    }

    if (request.method === "GET" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "events") {
      const after = url.searchParams.get("after");
      return sendJson(response, 200, after === null ? await getEvents(segments[2]) : await getEventsSince(segments[2], Number(after)));
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "run") {
      // Base64-encoded image/PDF attachments expand in transit. The durable
      // attachment budget below remains 6 MB of raw file bytes.
      const body = await readRequestBody(request, { maxBytes: 8_500_000 });
      if (typeof body.task !== "string" || !body.task.trim()) return sendJson(response, 400, { error: "task must be a non-empty string" });
      if (runSupervisor.hasActive(segments[2])) return sendJson(response, 409, { error: "This session is already running" });
      const recovered = await recoverSessionTranscript(segments[2]);
      if (!recovered.validation.valid) return sendJson(response, 409, { error: "Session transcript is inconsistent", violations: recovered.validation.violations });
      const previousEvents = recovered.events;
      const shouldRename = !previousEvents.some((event) => event.type === "user_message")
        && !previousEvents.some((event) => event.type === "session_renamed" && event.data?.source === "user");
      const runId = randomUUID();
      const attachments = normalizeAttachments(body.attachments);
      const permissionMode = normalizePermissionMode(body.permissionMode);
      const runtimeSnapshot = publicRuntimeConfig();
      const modelEnvironment = getModelEnvironment();
      await appendEvent(segments[2], "run_preferences_selected", {
        permissionMode,
        model: getPublicModelConfig(),
        budgetPolicy: runtimeSnapshot.budgetPolicy,
        attachments: attachments.map(attachmentMetadata),
        runId
      });
      for (const attachment of attachments) {
        await appendEvent(segments[2], "attachment_added", { attachment, runId });
      }
      await appendEvent(segments[2], "user_message", {
        content: body.task.trim(),
        displayContent: body.task.trim(),
        attachmentIds: attachments.map(({ id }) => id),
        attachments: attachments.map(attachmentMetadata),
        runId
      });
      interactiveLeases.set(segments[2], Date.now());
      const handle = await runSupervisor.schedule({
        sessionId: segments[2],
        runId,
        kind: "foreground",
        execute: ({ signal }) => runTextAgent(segments[2], body.task.trim(), shouldRename, signal, runId, {
          permissionMode,
          budgetPolicy: runtimeSnapshot.budgetPolicy,
          runtimeSnapshot,
          modelEnvironment
        })
      });
      void handle.promise.catch(async (error) => {
        await appendEvent(segments[2], "agent_error", { ...publicModelFailure(error), runId });
      }).finally(() => {
        interactiveLeases.delete(segments[2]);
      });
      return sendJson(response, 202, { accepted: true, runId });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "resume") {
      if (runSupervisor.hasActive(segments[2])) return sendJson(response, 409, { error: "This session is already running" });
      const recovered = await recoverSessionTranscript(segments[2]);
      if (!recovered.projection.messages.length || !recovered.projection.latestTask) return sendJson(response, 404, { error: "No recoverable session transcript found" });
      if (!recovered.validation.valid) return sendJson(response, 409, { error: "Session transcript is inconsistent", violations: recovered.validation.violations });
      if (["completed", "failed", "cancelled"].includes(recovered.projection.latestState)) return sendJson(response, 409, { error: "The latest task already has a terminal state" });
      const runId = recovered.projection.latestRunId ?? randomUUID();
      interactiveLeases.set(segments[2], Date.now());
      await appendEvent(segments[2], "session_resumed", { source: "transcript", state: recovered.projection.latestState, lastEventId: recovered.projection.lastEventId, runId });
      const handle = await runSupervisor.schedule({
        sessionId: segments[2],
        runId,
        kind: "foreground",
        execute: ({ signal }) => runTextAgent(segments[2], recovered.projection.latestTask, false, signal, runId, latestRunPreferences(recovered.events))
      });
      void handle.promise.catch(async (error) => {
        await appendEvent(segments[2], "agent_error", { ...publicModelFailure(error), runId });
      }).finally(() => {
        interactiveLeases.delete(segments[2]);
      });
      return sendJson(response, 202, { accepted: true, resumed: true, runId });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "cancel") {
      const stopped = await cancelActiveRun(segments[2], cancellation("user_stop", "用户停止了当前任务。"));
      if (!stopped) return sendJson(response, 404, { error: "No active run for this session" });
      return sendJson(response, 202, { accepted: true });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "heartbeat") {
      if (runSupervisor.hasActive(segments[2])) interactiveLeases.set(segments[2], Date.now());
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "disconnect") {
      await endInteractiveSession(segments[2], "browser_disconnected");
      return sendJson(response, 202, { ok: true });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "permission") {
      const body = await readRequestBody(request);
      const pending = pendingPermissions.get(body.requestId);
      if (!pending || pending.sessionId !== segments[2]) return sendJson(response, 404, { error: "Permission request not found" });
      pendingPermissions.delete(body.requestId);
      const decision = ["allow_once", "allow_session", "deny_task"].includes(body.decision)
        ? body.decision
        : body.approved === true ? "allow_once" : "deny_task";
      await appendEvent(segments[2], "permission_decision", { requestId: body.requestId, tool: pending.tool, decision, runId: pending.runId });
      pending.resolve(decision);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "changes" && segments[4] === "revert") {
      if (runSupervisor.hasActive(segments[2])) return sendJson(response, 409, { error: "Wait for the active run to finish before reverting files" });
      const body = await readRequestBody(request);
      if (typeof body.runId !== "string" || !body.runId) return sendJson(response, 400, { error: "runId is required" });
      const events = await getEvents(segments[2]);
      const result = await revertRunFileChanges({ events, runId: body.runId, workspaceRoot });
      await appendEvent(segments[2], "file_changes_reverted", { ...result, runId: body.runId });
      return sendJson(response, 200, { ok: true, ...result });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "archive") {
      await archiveSession(segments[2]);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "POST" && segments[0] === "api" && segments[1] === "sessions" && segments[3] === "restore") {
      await restoreSession(segments[2]);
      return sendJson(response, 200, { ok: true });
    }

    if (request.method === "DELETE" && segments[0] === "api" && segments[1] === "sessions" && segments.length === 3) {
      await deleteSession(segments[2]);
      return sendJson(response, 200, { ok: true });
    }

    return serveStatic(request, response);
  } catch (error) {
    console.error(error);
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    return sendJson(response, status, { error: error instanceof Error ? error.message : "Unknown server error" });
  }
});

await initializeModelRuntimeConfig();
await workspacePreview.listen();
await anthropicOpenAiGateway.start();
const browserRecovery = await browserRuntime.recoverPersistedSessions();
interactionManager.restoreBrowserSessions(browserRecovery.recovered);

const recoverableSessions = await listSessions(false, { includeSidechains: true });
await executionBroker.recoverOrphans(
  recoverableSessions.map((session) => session.id),
  getEvents
);
await runSupervisor.recoverOrphans(
  recoverableSessions.map((session) => session.id),
  getEvents,
  async ({ sessionId }) => recoverSessionTranscript(sessionId)
);

server.listen(port, "127.0.0.1", () => {
  console.log(`CodePilot Workspace is running at http://localhost:${port}`);
});

let shutdownStarted = false;
async function gracefulShutdown(signalName) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  await runSupervisor.shutdown({ reason: "server_shutdown", code: "SERVER_SHUTDOWN", message: `Server received ${signalName}` });
  await executionBroker.shutdown({
    reason: { reason: "server_shutdown", code: "SERVER_SHUTDOWN", message: `Server received ${signalName}` }
  });
  await interactionManager.close({ preserveRecovery: true });
  await capabilityManager.close();
  await mcpAuthManager.close();
  await workspacePreview.close();
  await anthropicOpenAiGateway.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}

process.once("SIGINT", () => void gracefulShutdown("SIGINT"));
process.once("SIGTERM", () => void gracefulShutdown("SIGTERM"));
