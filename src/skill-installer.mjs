import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { buildTool } from "./tools/tool-contract.mjs";
import { toolError, toolSuccess } from "./tools/tool-result.mjs";
import { parseSkillDocument, recordSkillInstallation } from "./skill-catalog.mjs";

const installerLimits = Object.freeze({
  maxFiles: 96,
  maxFileBytes: 512_000,
  maxTotalBytes: 4_000_000,
  maxDepth: 8
});

const blockedExtensions = new Set([
  ".exe", ".dll", ".com", ".msi", ".scr", ".sys", ".jar",
  ".app", ".dmg", ".pkg", ".deb", ".rpm", ".apk",
  ".bat", ".cmd", ".ps1", ".vbs", ".reg"
]);
const scriptExtensions = new Set([".js", ".mjs", ".cjs", ".ts", ".py", ".sh", ".rb", ".php", ".pl"]);

function parseGithubSource(input) {
  let url;
  try { url = new URL(input.url); } catch { return { error: "url must be a valid GitHub URL" }; }
  if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) {
    return { error: "Only HTTPS github.com repository URLs are supported" };
  }
  if (url.username || url.password || url.search || url.hash) {
    return { error: "GitHub Skill URLs must not contain credentials, query parameters, or fragments" };
  }
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return { error: "GitHub URL must include owner and repository" };
  const [owner, repositoryWithSuffix] = parts;
  const repository = repositoryWithSuffix.replace(/\.git$/i, "");
  let ref = input.ref;
  let path = input.path || "";
  if (parts[2] === "tree" && parts[3]) {
    ref = input.ref || parts[3];
    path = input.path || parts.slice(4).join("/");
  }
  if (![owner, repository, ...(ref ? [ref] : [])].every((value) => /^[A-Za-z0-9._/-]+$/.test(value)) || path.split("/").some((part) => part === "..")) {
    return { error: "GitHub owner, repository, ref, or path contains unsupported characters" };
  }
  return { owner, repository, ref, path: path.replace(/^\/+|\/+$/g, "") };
}

function assertSafeRelativePath(path) {
  const normalized = String(path).replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || isAbsolute(normalized) || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
  return normalized;
}

function looksExecutable(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) return true;
  if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) return true;
  const magic = buffer.subarray(0, 4).toString("hex");
  return ["cffaedfe", "cefaedfe", "feedfacf", "feedface"].includes(magic);
}

async function fetchGithubJson(fetchImpl, url, { token, signal } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "CodePilot-SkillInstaller/0.1",
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    signal
  });
  if (!response.ok) {
    const remaining = response.headers?.get?.("x-ratelimit-remaining");
    const resetSeconds = Number(response.headers?.get?.("x-ratelimit-reset"));
    const resetAt = Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000).toISOString() : null;
    if (response.status === 403 && remaining === "0") {
      throw new Error(
        `GitHub API rate limit exhausted${resetAt ? ` until ${resetAt}` : ""}. Set CODEPILOT_GITHUB_TOKEN and retry.`
      );
    }
    throw new Error(`GitHub API request failed with status ${response.status}`);
  }
  return response.json();
}

async function fetchFile(fetchImpl, url, { token, signal } = {}) {
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": "CodePilot-SkillInstaller/0.1",
      ...(token && url.startsWith("https://api.github.com/") ? { authorization: `Bearer ${token}` } : {})
    },
    signal
  });
  if (!response.ok) throw new Error(`GitHub file download failed with status ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function collectGithubFiles(fetchImpl, source, options = {}) {
  const files = [];
  const visit = async (path, depth) => {
    if (depth > installerLimits.maxDepth) throw new Error(`Skill directory exceeds maximum depth ${installerLimits.maxDepth}`);
    const encodedPath = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
    const endpoint = `https://api.github.com/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/contents/${encodedPath}${source.ref ? `?ref=${encodeURIComponent(source.ref)}` : ""}`;
    const listing = await fetchGithubJson(fetchImpl, endpoint, options);
    const entries = Array.isArray(listing) ? listing : [listing];
    for (const entry of entries) {
      if (entry.type === "symlink" || entry.type === "submodule") throw new Error(`Skill contains unsupported ${entry.type}: ${entry.path}`);
      if (entry.type === "dir") {
        await visit(entry.path, depth + 1);
        continue;
      }
      if (entry.type !== "file" || !entry.download_url) throw new Error(`Unsupported GitHub entry: ${entry.path}`);
      if (files.length >= installerLimits.maxFiles) throw new Error(`Skill exceeds maximum file count ${installerLimits.maxFiles}`);
      if (Number(entry.size) > installerLimits.maxFileBytes) throw new Error(`Skill file is too large: ${entry.path}`);
      const relativePath = source.path ? relative(source.path, entry.path).replaceAll("\\", "/") : entry.path;
      files.push({ path: assertSafeRelativePath(relativePath), downloadUrl: entry.download_url, declaredSize: Number(entry.size) || 0 });
    }
  };
  await visit(source.path, 0);
  return files;
}

function selectSkillRoot(files) {
  const manifests = files.filter((file) => /(^|\/)SKILL\.md$/i.test(file.path));
  const rootManifest = manifests.find((file) => /^SKILL\.md$/i.test(file.path));
  if (rootManifest) return "";
  if (manifests.length === 1) return dirname(manifests[0].path).replaceAll("\\", "/").replace(/^\.$/, "");
  if (!manifests.length) throw new Error("GitHub source does not contain SKILL.md");
  throw new Error("GitHub source contains multiple Skills; provide the exact path");
}

function targetName(inputName, source, skillRoot) {
  const fallback = skillRoot
    ? skillRoot.split("/").at(-1)
    : source.path
      ? source.path.split("/").at(-1)
      : source.repository;
  const name = String(inputName || fallback).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(name)) throw new Error("Installed Skill name must use letters, numbers, underscore, or hyphen");
  return name;
}

function isInside(root, candidate) {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith(`..${sep}`) && relation !== ".." && !isAbsolute(relation));
}

export async function installGithubSkill({
  workspaceRoot,
  url,
  ref,
  path,
  name,
  fetchImpl = fetch,
  githubToken,
  signal
}) {
  const source = parseGithubSource({ url, ref, path });
  if (source.error) throw new Error(source.error);
  const descriptors = await collectGithubFiles(fetchImpl, source, { token: githubToken, signal });
  const skillRoot = selectSkillRoot(descriptors);
  const selected = descriptors.filter((file) => !skillRoot || file.path === `${skillRoot}/SKILL.md` || file.path.startsWith(`${skillRoot}/`));
  const skillName = targetName(name, source, skillRoot);
  const skillsDirectory = join(workspaceRoot, ".codepilot", "skills");
  const target = join(skillsDirectory, skillName);
  try {
    await stat(target);
    const error = new Error(`Skill already exists: ${skillName}`);
    error.code = "SKILL_ALREADY_INSTALLED";
    throw error;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const stagingRoot = join(workspaceRoot, ".codepilot", "skill-staging", randomUUID());
  const quarantinedFiles = [];
  let totalBytes = 0;
  try {
    for (const descriptor of selected) {
      const stripped = skillRoot ? descriptor.path.slice(skillRoot.length + 1) : descriptor.path;
      const relativePath = assertSafeRelativePath(stripped);
      const extension = extname(relativePath).toLowerCase();
      if (blockedExtensions.has(extension)) throw new Error(`Skill contains a blocked executable file: ${relativePath}`);
      const buffer = await fetchFile(fetchImpl, descriptor.downloadUrl, { token: githubToken, signal });
      if (buffer.length > installerLimits.maxFileBytes) throw new Error(`Skill file is too large: ${relativePath}`);
      if (looksExecutable(buffer)) throw new Error(`Skill contains executable binary content: ${relativePath}`);
      totalBytes += buffer.length;
      if (totalBytes > installerLimits.maxTotalBytes) throw new Error(`Skill exceeds total download limit ${installerLimits.maxTotalBytes}`);
      if (scriptExtensions.has(extension)) quarantinedFiles.push(relativePath);
      const destination = resolve(stagingRoot, relativePath);
      if (!isInside(stagingRoot, destination)) throw new Error(`Skill file escapes staging directory: ${relativePath}`);
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, buffer);
    }

    const manifestPath = join(stagingRoot, "SKILL.md");
    const { body } = parseSkillDocument(await readFile(manifestPath, "utf8"));
    if (!body.trim()) throw new Error("SKILL.md has no instruction body");
    const installation = {
      source: "github",
      trust: "untrusted",
      repository: `${source.owner}/${source.repository}`,
      ref: source.ref || "default",
      path: source.path || skillRoot || "",
      sourceUrl: url,
      installedAt: new Date().toISOString(),
      quarantinedFiles
    };
    await recordSkillInstallation(workspaceRoot, skillName, installation);
    await mkdir(skillsDirectory, { recursive: true });
    await rename(stagingRoot, target);
    return { name: skillName, path: `.codepilot/skills/${skillName}/SKILL.md`, files: selected.length, totalBytes, quarantinedFiles, installation };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  }
}

export function buildInstallSkillTool({ workspaceRoot, fetchImpl = fetch, githubToken } = {}) {
  return buildTool({
    name: "InstallSkill",
    description: "Install a Skill from a public GitHub repository into the local project Skill library. Installation is reviewed and approved separately from activation; downloaded Skills remain untrusted and read-only restricted.",
    inputSchema: z.object({
      url: z.string().url().max(2_000).describe("HTTPS github.com repository or tree URL"),
      ref: z.string().trim().min(1).max(200).optional().describe("Optional branch, tag, or commit; use this for refs containing slashes"),
      path: z.string().trim().max(1_000).optional().describe("Optional repository directory containing SKILL.md"),
      name: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/).optional().describe("Optional local Skill directory name")
    }).strict(),
    isReadOnly: false,
    isConcurrencySafe: false,
    maxResultSizeChars: 8_000,
    validateInput: async (input) => {
      const source = parseGithubSource(input);
      if (source.error) return toolError("SKILL_SOURCE_INVALID", source.error, { url: input.url });
    },
    checkPermissions: async (input) => ({
      decision: "ask",
      nonBypassable: true,
      summary: `从 GitHub 下载并安装 Skill：${input.url}`,
      details: {
        risk: "远程 Skill 可能包含恶意指令或脚本；安装后保持未信任状态，脚本不会自动执行，激活时只允许只读安全工具。"
      }
    }),
    preparePermissionMatcher: async (input) => ({ toolName: "InstallSkill", operation: "install_skill", source: input.url, path: input.path ?? "" }),
    renderToolUseMessage: (input, view) => ({
      title: view.phase === "completed" ? "Skill 已安装" : "安装 Skill",
      detail: input.name || input.path || input.url
    }),
    async call(input, context) {
      try {
        const result = await installGithubSkill({
          workspaceRoot: context?.workspaceRoot ?? workspaceRoot,
          ...input,
          fetchImpl,
          githubToken,
          signal: context?.signal
        });
        return toolSuccess(`Installed Skill ${result.name} at ${result.path}`, result);
      } catch (error) {
        return toolError(error?.code ?? "SKILL_INSTALL_FAILED", "GitHub Skill installation failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  });
}

export function buildDiscoverSkillsTool({ fetchImpl = fetch, githubToken } = {}) {
  return buildTool({
    name: "DiscoverSkills",
    description: "Search GitHub for repositories containing SKILL.md before installing a requested Skill. Returns source coordinates for InstallSkill; it does not download or activate anything.",
    inputSchema: z.object({
      query: z.string().trim().min(2).max(200),
      maxResults: z.number().int().min(1).max(10).default(5)
    }).strict(),
    isReadOnly: true,
    isConcurrencySafe: true,
    maxResultSizeChars: 12_000,
    preparePermissionMatcher: async (input) => ({ toolName: "DiscoverSkills", operation: "github_search", query: input.query }),
    renderToolUseMessage: (input, view) => ({
      title: view.phase === "completed" ? "GitHub Skill 搜索完成" : "搜索 GitHub Skills",
      detail: input.query
    }),
    async call(input, context) {
      try {
        const query = encodeURIComponent(`${input.query} filename:SKILL.md`);
        const result = await fetchGithubJson(
          fetchImpl,
          `https://api.github.com/search/code?q=${query}&per_page=${input.maxResults}`,
          { token: githubToken, signal: context?.signal }
        );
        const candidates = (result.items ?? []).slice(0, input.maxResults).map((item) => ({
          repository: item.repository?.full_name,
          path: dirname(item.path ?? "SKILL.md").replaceAll("\\", "/").replace(/^\.$/, ""),
          sourceUrl: item.repository?.html_url,
          install: {
            url: item.repository?.html_url,
            path: dirname(item.path ?? "SKILL.md").replaceAll("\\", "/").replace(/^\.$/, "")
          }
        })).filter((item) => item.repository && item.sourceUrl);
        return toolSuccess(JSON.stringify(candidates, null, 2), {
          query: input.query,
          candidates: candidates.length,
          authentication: githubToken ? "configured" : "anonymous"
        });
      } catch (error) {
        return toolError("SKILL_DISCOVERY_FAILED", "GitHub Skill discovery failed", {
          message: error instanceof Error ? error.message : String(error),
          hint: githubToken ? undefined : "Configure CODEPILOT_GITHUB_TOKEN if GitHub code search requires authentication."
        });
      }
    }
  });
}

export { parseGithubSource, installerLimits };
