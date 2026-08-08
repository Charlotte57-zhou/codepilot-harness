import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { buildTool } from "./tools/tool-contract.mjs";
import { toolError, toolSuccess } from "./tools/tool-result.mjs";
import { resolveWorkspacePath } from "./tools/workspace-path.mjs";

const defaultLimits = Object.freeze({
  maxEntries: 64,
  maxCharsPerSkill: 50_000
});
const remoteSafeTools = Object.freeze(["ListFiles", "Read", "Search"]);
const stateWriteQueues = new Map();

async function withSkillStateLock(workspaceRoot, operation) {
  const previous = stateWriteQueues.get(workspaceRoot) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  stateWriteQueues.set(workspaceRoot, current);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (stateWriteQueues.get(workspaceRoot) === current) stateWriteQueues.delete(workspaceRoot);
  }
}

function parseBoolean(value, fallback) {
  if (value === undefined) return fallback;
  return !["false", "no", "0", "off"].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function parseFrontmatter(content) {
  const source = String(content);
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { attributes: {}, body: source.trim() };
  const attributes = {};
  let listKey;
  for (const line of match[1].split(/\r?\n/)) {
    const listItem = line.match(/^\s*-\s+(.+?)\s*$/);
    if (listItem && listKey) {
      const current = Array.isArray(attributes[listKey]) ? attributes[listKey] : [];
      current.push(listItem[1].replace(/^['"]|['"]$/g, ""));
      attributes[listKey] = current;
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const raw = line.slice(separator + 1).trim();
    if (!raw) {
      attributes[key] = [];
      listKey = key;
      continue;
    }
    listKey = undefined;
    const inlineList = raw.match(/^\[(.*)\]$/);
    attributes[key] = inlineList
      ? inlineList[1].split(",").map((item) => item.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean)
      : raw.replace(/^['"]|['"]$/g, "");
  }
  return { attributes, body: match[2].trim() };
}

export function parseSkillDocument(content) {
  return parseFrontmatter(content);
}

function fallbackDescription(body) {
  return String(body)
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean)
    ?.slice(0, 240) || "Project skill";
}

function validSkillName(name) {
  return typeof name === "string"
    && name.length > 0
    && name.length <= 80
    && !/[\u0000-\u001f/\\]/.test(name);
}

function diagnostic(code, message, path, details = {}) {
  return { code, message, path, ...details };
}

async function readSkillState(workspaceRoot) {
  const path = ".codepilot/skills.json";
  try {
    const value = JSON.parse(await readFile(join(workspaceRoot, path), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { state: {}, diagnostics: [diagnostic("SKILL_STATE_INVALID", "skills.json must contain an object", path)] };
    }
    return { state: value, diagnostics: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: {}, diagnostics: [] };
    if (error instanceof SyntaxError) {
      return { state: {}, diagnostics: [diagnostic("SKILL_STATE_INVALID", "skills.json is not valid JSON", path)] };
    }
    throw error;
  }
}

async function readInstallationState(workspaceRoot) {
  const path = ".codepilot/skill-installations.json";
  try {
    const value = JSON.parse(await readFile(join(workspaceRoot, path), "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { state: {}, diagnostics: [diagnostic("SKILL_INSTALLATION_STATE_INVALID", "skill-installations.json must contain an object", path)] };
    }
    return { state: value, diagnostics: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { state: {}, diagnostics: [] };
    if (error instanceof SyntaxError) {
      return { state: {}, diagnostics: [diagnostic("SKILL_INSTALLATION_STATE_INVALID", "skill-installations.json is not valid JSON", path)] };
    }
    throw error;
  }
}

export async function loadSkillState(workspaceRoot) {
  return (await readSkillState(workspaceRoot)).state;
}

async function skillCandidates(workspaceRoot, maxEntries) {
  const directory = join(workspaceRoot, ".codepilot", "skills");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { candidates: [], diagnostics: [], truncated: false };
    throw error;
  }

  const candidates = [];
  const diagnostics = [];
  const sorted = entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of sorted.slice(0, maxEntries)) {
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      candidates.push({
        name: entry.name,
        path: `.codepilot/skills/${entry.name}/SKILL.md`,
        root: `.codepilot/skills/${entry.name}`,
        format: "directory"
      });
    }
  }
  if (sorted.length > maxEntries) {
    diagnostics.push(diagnostic(
      "SKILL_CATALOG_LIMIT",
      `Only the first ${maxEntries} skill entries were inspected`,
      ".codepilot/skills",
      { omittedEntries: sorted.length - maxEntries }
    ));
  }
  return { candidates, diagnostics, truncated: sorted.length > maxEntries };
}

/**
 * Discovers project Skills and returns one immutable catalog view. Skills use
 * the current .codepilot/skills/<name>/SKILL.md directory contract.
 */
export async function loadSkillCatalog(workspaceRoot, limits = {}) {
  const { maxEntries, maxCharsPerSkill } = { ...defaultLimits, ...limits };
  const [{ state, diagnostics: stateDiagnostics }, installationRecord, candidateResult] = await Promise.all([
    readSkillState(workspaceRoot),
    readInstallationState(workspaceRoot),
    skillCandidates(workspaceRoot, maxEntries)
  ]);
  const diagnostics = [...stateDiagnostics, ...installationRecord.diagnostics, ...candidateResult.diagnostics];
  const skills = [];
  const names = new Set();

  for (const candidate of candidateResult.candidates) {
    const resolved = await resolveWorkspacePath(workspaceRoot, candidate.path);
    if (!resolved.ok) {
      diagnostics.push(diagnostic(
        resolved.result.error.code === "PATH_NOT_FOUND" ? "SKILL_FILE_MISSING" : "SKILL_PATH_INVALID",
        resolved.result.error.message,
        candidate.path
      ));
      continue;
    }
    let source;
    try {
      source = await readFile(resolved.absolutePath, "utf8");
    } catch (error) {
      diagnostics.push(diagnostic("SKILL_READ_FAILED", "Skill source could not be read", candidate.path, { reason: error?.code ?? "unknown" }));
      continue;
    }
    const { attributes, body } = parseFrontmatter(source);
    const name = candidate.name;
    if (!validSkillName(name)) {
      diagnostics.push(diagnostic("SKILL_NAME_INVALID", "Skill name must be 1-80 characters and contain no path separators", candidate.path));
      continue;
    }
    if (names.has(name)) {
      diagnostics.push(diagnostic("SKILL_NAME_DUPLICATE", `Duplicate skill name: ${name}`, candidate.path));
      continue;
    }
    names.add(name);
    const truncated = body.length > maxCharsPerSkill;
    const instructions = body.slice(0, maxCharsPerSkill);
    if (!instructions) {
      diagnostics.push(diagnostic("SKILL_BODY_EMPTY", `Skill ${name} has no instructions`, candidate.path));
      continue;
    }
    if (truncated) {
      diagnostics.push(diagnostic(
        "SKILL_CONTENT_TRUNCATED",
        `Skill ${name} exceeds the ${maxCharsPerSkill} character activation limit`,
        candidate.path,
        { originalChars: body.length }
      ));
    }
    const installation = installationRecord.state[name];
    const executionContext = attributes.context === "fork" ? "fork" : "inline";
    const modelInvocable = attributes["model-invocable"] === undefined
      ? !parseBoolean(attributes["disable-model-invocation"], false)
      : parseBoolean(attributes["model-invocable"], true);
    const userInvocable = parseBoolean(attributes["user-invocable"], true);
    const argumentNames = parseList(attributes.arguments);
    const allowedTools = parseList(attributes["allowed-tools"]);
    const paths = parseList(attributes.paths);
    const maxTurns = Math.min(12, Math.max(1, Number(attributes["max-turns"] ?? 6) || 6));
    if (!["inline", "fork"].includes(attributes.context ?? "inline")) {
      diagnostics.push(diagnostic("SKILL_CONTEXT_INVALID", `Skill ${name} context must be inline or fork`, candidate.path));
    }
    skills.push(Object.freeze({
      name,
      displayName: attributes.name || name,
      description: attributes.description || fallbackDescription(body),
      whenToUse: attributes.when_to_use || attributes["when-to-use"] || "",
      version: attributes.version || "",
      allowedTools,
      argumentNames,
      argumentHint: attributes["argument-hint"] || "",
      paths,
      modelInvocable,
      userInvocable,
      executionContext,
      agent: attributes.agent || "",
      model: attributes.model && attributes.model !== "inherit" ? attributes.model : "",
      effort: attributes.effort || "",
      maxTurns,
      instructions,
      path: candidate.path,
      root: candidate.root,
      format: candidate.format,
      source: installation?.source ?? "project",
      trust: installation?.trust ?? "local",
      installation: installation ? Object.freeze({ ...installation }) : undefined,
      enabled: state[name] ?? parseBoolean(attributes.enabled, true),
      truncated,
      contentLength: body.length
    }));
  }

  return Object.freeze({
    skills: Object.freeze(skills),
    diagnostics: Object.freeze(diagnostics),
    truncated: candidateResult.truncated
  });
}

function globExpression(pattern) {
  return new RegExp(`^${String(pattern)
    .replaceAll("\\", "/")
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*")}$`, "i");
}

export function isSkillEligible(skill, { task = "", touchedPaths = [] } = {}) {
  if (!skill.enabled || !skill.modelInvocable) return false;
  if (!skill.paths.length) return true;
  if (String(task).toLowerCase().includes(skill.name.toLowerCase())) return true;
  const taskPaths = String(task).match(/(?:[A-Za-z]:)?[\w./\\-]+\.[A-Za-z0-9]+/g) ?? [];
  const candidates = [...touchedPaths, ...taskPaths].map((value) => String(value).replaceAll("\\", "/").replace(/^\.\//, ""));
  return skill.paths.some((pattern) => candidates.some((candidate) => globExpression(pattern).test(candidate)));
}

export function effectiveSkillAllowedTools(skill) {
  const declared = [...new Set(skill.allowedTools)];
  if (skill.trust === "untrusted") {
    const restricted = declared.length ? declared.filter((name) => remoteSafeTools.includes(name)) : [...remoteSafeTools];
    return [...new Set(["Skill", ...restricted])];
  }
  return declared.length ? [...new Set(["Skill", ...declared])] : null;
}

function substituteSkillVariables(skill, input, context) {
  const parameters = input.parameters ?? {};
  let content = skill.instructions
    .replaceAll("${CODEPILOT_SKILL_DIR}", skill.root.replaceAll("\\", "/"))
    .replaceAll("${CODEPILOT_SESSION_ID}", String(context.sessionId ?? "unknown"))
    .replaceAll("${ARGUMENTS}", input.args ?? "")
    .replaceAll("$ARGUMENTS", input.args ?? "");
  for (const name of skill.argumentNames) {
    const value = String(parameters[name] ?? "");
    content = content.replaceAll(`\${${name}}`, value).replaceAll(`$${name}`, value);
  }
  return content;
}

export function rehydrateSkillScopes(messages = []) {
  const scopes = [];
  const seen = new Set();
  for (const message of messages) {
    if (message.role !== "tool" || typeof message.content !== "string") continue;
    let record;
    try { record = JSON.parse(message.content); } catch { continue; }
    const metadata = record?.metadata;
    if (metadata?.skillExecutionContext !== "inline" || !Array.isArray(metadata.enforcedAllowedTools) || seen.has(metadata.skill)) continue;
    scopes.push({ skill: metadata.skill, allowedTools: [...metadata.enforcedAllowedTools], trust: metadata.trust ?? "local" });
    seen.add(metadata.skill);
  }
  return scopes;
}

export async function loadSkillsDir(workspaceRoot, limits) {
  return (await loadSkillCatalog(workspaceRoot, limits)).skills;
}

async function writeSkillState(workspaceRoot, state) {
  const directory = join(workspaceRoot, ".codepilot");
  const target = join(directory, "skills.json");
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

async function writeInstallationState(workspaceRoot, state) {
  const directory = join(workspaceRoot, ".codepilot");
  const target = join(directory, "skill-installations.json");
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, target);
}

export async function recordSkillInstallation(workspaceRoot, name, installation) {
  return withSkillStateLock(workspaceRoot, async () => {
    const record = await readInstallationState(workspaceRoot);
    if (record.diagnostics.length) {
      const error = new Error("Skill installation state is invalid; repair .codepilot/skill-installations.json before installing");
      error.statusCode = 409;
      throw error;
    }
    const state = { ...record.state, [name]: { ...installation } };
    await writeInstallationState(workspaceRoot, state);
    return state[name];
  });
}

export async function setSkillEnabled(workspaceRoot, name, enabled) {
  return withSkillStateLock(workspaceRoot, async () => {
    const catalog = await loadSkillCatalog(workspaceRoot);
    if (!catalog.skills.some((skill) => skill.name === name)) {
      const error = new Error(`Unknown skill: ${name}`);
      error.statusCode = 404;
      throw error;
    }
    const stateRecord = await readSkillState(workspaceRoot);
    if (stateRecord.diagnostics.length) {
      const error = new Error("Skill state is invalid; repair .codepilot/skills.json before changing it");
      error.statusCode = 409;
      throw error;
    }
    const state = { ...stateRecord.state, [name]: Boolean(enabled) };
    await writeSkillState(workspaceRoot, state);
    return state;
  });
}

export async function uninstallSkill(workspaceRoot, name) {
  return withSkillStateLock(workspaceRoot, async () => {
    const catalog = await loadSkillCatalog(workspaceRoot);
    const skill = catalog.skills.find((candidate) => candidate.name === name);
    if (!skill) {
      const error = new Error(`Unknown skill: ${name}`);
      error.statusCode = 404;
      throw error;
    }

    const resolved = await resolveWorkspacePath(workspaceRoot, skill.path);
    if (!resolved.ok) {
      const error = new Error(resolved.result.error.message);
      error.statusCode = 409;
      throw error;
    }
    await unlink(resolved.absolutePath);
    if (skill.format === "directory") {
      await rmdir(dirname(resolved.absolutePath)).catch((error) => {
        if (!["ENOTEMPTY", "EEXIST"].includes(error?.code)) throw error;
      });
    }

    const stateRecord = await readSkillState(workspaceRoot);
    if (!stateRecord.diagnostics.length && Object.hasOwn(stateRecord.state, name)) {
      const state = { ...stateRecord.state };
      delete state[name];
      await writeSkillState(workspaceRoot, state);
    }
    const installationRecord = await readInstallationState(workspaceRoot);
    if (!installationRecord.diagnostics.length && Object.hasOwn(installationRecord.state, name)) {
      const installations = { ...installationRecord.state };
      delete installations[name];
      await writeInstallationState(workspaceRoot, installations);
    }
    return { name, path: skill.path, directory: skill.format === "directory" ? dirname(skill.path) : undefined };
  });
}

export function buildSkillTool(skills) {
  const active = skills.filter((skill) => skill.enabled);
  if (!active.length) return undefined;
  const byName = new Map(active.map((skill) => [skill.name, skill]));
  const names = [...byName.keys()];
  return buildTool({
    name: "Skill",
    description: "Load one enabled project Skill when its workflow is relevant. Use the exact skill name from Available Skills before following its instructions.",
    inputSchema: z.object({
      skill: z.enum(names),
      args: z.string().max(4_000).optional().describe("Optional positional arguments passed as $ARGUMENTS"),
      parameters: z.record(z.string().max(4_000)).optional().describe("Named Skill parameters declared by frontmatter")
    }).strict(),
    isReadOnly: true,
    isConcurrencySafe: false,
    checkPermissions: async (input) => {
      const skill = byName.get(input.skill);
      return skill?.trust === "untrusted"
        ? {
            decision: "ask",
            nonBypassable: true,
            summary: `激活来自 GitHub 的未信任 Skill：${skill.name}。其工具范围将被限制为只读安全工具。`,
            details: { skill: skill.name, source: skill.source, trust: skill.trust }
          }
        : { decision: "allow", summary: `Activate Skill ${input.skill}` };
    },
    preparePermissionMatcher: async (input) => ({ toolName: "Skill", operation: "activate", skill: input.skill }),
    maxResultSizeChars: defaultLimits.maxCharsPerSkill + 4_000,
    renderToolUseMessage: (input, view) => ({
      title: `Skill: ${input.skill}`,
      detail: view.phase === "completed" ? "技能说明已载入当前上下文" : "正在按需载入技能说明"
    }),
    async call(input, context = {}) {
      const skill = byName.get(input.skill);
      if (!skill) return toolError("SKILL_NOT_IN_SNAPSHOT", "Skill is not available in the current capability snapshot", { skill: input.skill });
      const undeclared = Object.keys(input.parameters ?? {}).filter((name) => !skill.argumentNames.includes(name));
      if (undeclared.length) return toolError("SKILL_ARGUMENT_UNKNOWN", "Skill invocation contains undeclared named parameters", { skill: skill.name, undeclared });
      await context.recordSkillLifecycle?.({ skill: skill.name, stage: "invoked", executionContext: skill.executionContext, trust: skill.trust });
      const enforcedAllowedTools = effectiveSkillAllowedTools(skill);
      const renderedInstructions = substituteSkillVariables(skill, input, context);
      const argumentsSection = input.args ? `\n\n# Invocation arguments\n${input.args}` : "";
      const truncation = skill.truncated ? "\n\n[Skill content was truncated at the catalog activation limit.]" : "";
      await context.recordSkillLifecycle?.({ skill: skill.name, stage: "activated", executionContext: skill.executionContext, trust: skill.trust });

      if (skill.executionContext === "fork") {
        await context.recordSkillLifecycle?.({ skill: skill.name, stage: "completed", executionContext: "fork", outcome: "delegated_to_sdk" });
        return toolSuccess(
          `Delegate this workflow to the Claude Agent SDK subagent named "${skill.name}".`,
          {
            skill: skill.name,
            path: skill.path,
            skillExecutionContext: "fork",
            trust: skill.trust,
            enforcedAllowedTools,
            sdkAgent: skill.name
          }
        );
      }

      if (enforcedAllowedTools) {
        const scopes = context.runtimeState?.activeSkillScopes ?? [];
        if (context.runtimeState) context.runtimeState.activeSkillScopes = scopes;
        if (!scopes.some((scope) => scope.skill === skill.name)) scopes.push({ skill: skill.name, allowedTools: enforcedAllowedTools, trust: skill.trust });
      }
      await context.recordSkillLifecycle?.({ skill: skill.name, stage: "completed", executionContext: "inline", outcome: "success" });
      return toolSuccess(
        `# Activated Skill: ${skill.displayName}\nBase directory: ${skill.root}\nSource: ${skill.path}\n\n${renderedInstructions}${argumentsSection}${truncation}`,
        {
          skill: skill.name, path: skill.path, version: skill.version || undefined,
          allowedTools: skill.allowedTools, enforcedAllowedTools,
          skillExecutionContext: "inline", trust: skill.trust, truncated: skill.truncated
        }
      );
    }
  });
}
