import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
const branchPattern = /^[a-z0-9][a-z0-9._/-]{0,79}$/i;
const remoteNamePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const repositorySlugPattern = /^[a-z0-9](?:[a-z0-9._-]{0,38})\/[a-z0-9](?:[a-z0-9._-]{0,99})$/i;
const maxOutput = 2 * 1024 * 1024;

const publicMessages = Object.freeze({
  CLI_MISSING: "请先安装 GitHub CLI，再连接这个项目。",
  AUTH_REQUIRED: "请先在终端运行 gh auth login 完成 GitHub 登录。",
  REMOTE_MISSING: "当前 Git 仓库还没有连接 GitHub 仓库。",
  REPOSITORY_INVALID: "GitHub 未识别当前仓库。",
  PERMISSION_DENIED: "当前 GitHub 身份没有完成此操作的权限。",
  NETWORK_FAILED: "GitHub 网络连接失败，请检查网络后重试。",
  CONFLICT: "远端状态与当前分支冲突，请先同步仓库后重试。",
  COMMAND_FAILED: "GitHub 操作未完成，请检查仓库状态后重试。"
});

export class GitHubCliError extends Error {
  constructor(code) {
    super(publicMessages[code] ?? publicMessages.COMMAND_FAILED);
    this.name = "GitHubCliError";
    this.code = publicMessages[code] ? code : "COMMAND_FAILED";
  }
}

async function defaultRunner(command, args, options) {
  return execFileAsync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: maxOutput,
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" }
  });
}

function commandText(error) {
  return `${error?.stderr ?? ""}\n${error?.message ?? ""}`.toLocaleLowerCase("en-US");
}

export function classifyGitHubCommandError(error, fallback = "COMMAND_FAILED") {
  if (error?.code === "ENOENT") return "CLI_MISSING";
  const detail = commandText(error);
  if (/not logged into|authentication required|auth login|http 401|bad credentials/.test(detail)) return "AUTH_REQUIRED";
  if (/permission|forbidden|http 403|resource not accessible/.test(detail)) return "PERMISSION_DENIED";
  if (/could not resolve|network|timed out|timeout|connection (?:failed|reset|refused)|unable to access/.test(detail)) return "NETWORK_FAILED";
  if (/non-fast-forward|fetch first|already exists|pull request.*exists|conflict/.test(detail)) return "CONFLICT";
  if (/not a git repository|could not determine base repository|repository not found|no git remotes/.test(detail)) return "REPOSITORY_INVALID";
  return fallback;
}

function validBranch(value) {
  return branchPattern.test(value ?? "") && !value.includes("..") && !value.includes("//") && !value.endsWith("/");
}

export function normalizeGitHubRepository(value) {
  const input = String(value ?? "").trim();
  const https = input.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+?)(?:\.git)?\/?$/i);
  const ssh = input.match(/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+)\/([^/?#]+?)(?:\.git)?$/i);
  const shorthand = input.match(/^([^/]+)\/([^/]+)$/);
  const parts = https || ssh || shorthand;
  if (!parts) throw new GitHubCliError("REPOSITORY_INVALID");
  const slug = `${parts[1]}/${parts[2]}`;
  if (!repositorySlugPattern.test(slug) || slug.includes("..")) throw new GitHubCliError("REPOSITORY_INVALID");
  return slug;
}

function boundedText(value, maximum, required = false) {
  const normalized = String(value ?? "").replace(/\r\n/g, "\n").trim();
  if ((required && !normalized) || normalized.length > maximum || normalized.includes("\0")) throw new GitHubCliError("COMMAND_FAILED");
  return normalized;
}

function projectionText(value, maximum, fallback) {
  const normalized = String(value ?? "").replace(/\0/g, "").replace(/\s+/g, " ").trim();
  return (normalized || fallback).slice(0, maximum);
}

function parseJson(value, fallbackCode = "COMMAND_FAILED") {
  try {
    const parsed = JSON.parse(String(value ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    return parsed;
  } catch {
    throw new GitHubCliError(fallbackCode);
  }
}

function checkBucket(item) {
  const conclusion = String(item?.conclusion ?? item?.state ?? "").toLocaleUpperCase("en-US");
  const status = String(item?.status ?? "").toLocaleUpperCase("en-US");
  if (["SUCCESS", "NEUTRAL"].includes(conclusion)) return conclusion === "SUCCESS" ? "pass" : "neutral";
  if (["SKIPPED", "STALE"].includes(conclusion)) return "skipping";
  if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(conclusion)) return "fail";
  if (["QUEUED", "IN_PROGRESS", "PENDING", "REQUESTED", "WAITING"].includes(status) || !conclusion) return "pending";
  return "unknown";
}

export function projectPullRequest(value) {
  if (!value || typeof value !== "object") return null;
  const number = Number(value.number);
  if (!Number.isInteger(number) || number <= 0) return null;
  const checks = Array.isArray(value.statusCheckRollup) ? value.statusCheckRollup.slice(0, 40).map((item) => Object.freeze({
    name: projectionText(item?.name || item?.context, 120, "Check"),
    state: projectionText(item?.conclusion || item?.state || item?.status, 40, "PENDING").toLocaleLowerCase("en-US"),
    bucket: checkBucket(item)
  })) : [];
  return Object.freeze({
    number,
    title: projectionText(value.title, 200, `Pull Request #${number}`),
    state: projectionText(value.state, 20, "OPEN").toLocaleLowerCase("en-US"),
    headBranch: validBranch(value.headRefName) ? value.headRefName : null,
    baseBranch: validBranch(value.baseRefName) ? value.baseRefName : null,
    checks: Object.freeze(checks)
  });
}

export class GitHubCliBridge {
  constructor({ runner = defaultRunner, globalCwd = process.cwd() } = {}) {
    this.runner = runner;
    this.globalCwd = resolve(globalCwd);
  }

  async command(command, args, cwd, fallback) {
    try {
      return await this.runner(command, Object.freeze([...args]), Object.freeze({ cwd: resolve(cwd) }));
    } catch (error) {
      throw new GitHubCliError(classifyGitHubCommandError(error, fallback));
    }
  }

  async optionalPullRequest(cwd, repositorySlug) {
    try {
      const result = await this.runner("gh", ["pr", "view", "--repo", repositorySlug, "--json", "number,title,state,headRefName,baseRefName,statusCheckRollup"], { cwd: resolve(cwd) });
      return projectPullRequest(parseJson(result.stdout));
    } catch (error) {
      const detail = commandText(error);
      if (/no pull requests found|no pull request found/.test(detail)) return null;
      throw new GitHubCliError(classifyGitHubCommandError(error));
    }
  }

  async inspect(workspacePath) {
    const cwd = resolve(workspacePath);
    try {
      await this.command("gh", ["--version"], this.globalCwd, "CLI_MISSING");
    } catch (error) {
      if (error instanceof GitHubCliError && error.code === "CLI_MISSING") return Object.freeze({ available: false, code: error.code, message: error.message });
      throw error;
    }
    try {
      await this.command("gh", ["auth", "status", "--hostname", "github.com"], this.globalCwd, "COMMAND_FAILED");
    } catch (error) {
      if (error instanceof GitHubCliError && error.code === "AUTH_REQUIRED") return Object.freeze({ available: false, code: error.code, message: error.message });
      throw error;
    }
    let branch;
    try {
      branch = (await this.command("git", ["rev-parse", "--abbrev-ref", "HEAD"], cwd, "REPOSITORY_INVALID")).stdout.trim();
    } catch (error) {
      if (error instanceof GitHubCliError && error.code === "REPOSITORY_INVALID") {
        return Object.freeze({ available: false, code: error.code, message: error.message });
      }
      throw error;
    }
    if (!validBranch(branch) || branch === "HEAD") {
      return Object.freeze({ available: false, code: "REPOSITORY_INVALID", message: publicMessages.REPOSITORY_INVALID });
    }
    let remoteNames;
    try {
      remoteNames = (await this.command("git", ["remote"], cwd, "REMOTE_MISSING")).stdout.split(/\r?\n/).map((name) => name.trim()).filter((name) => remoteNamePattern.test(name));
    } catch (error) {
      if (error instanceof GitHubCliError && ["REMOTE_MISSING", "COMMAND_FAILED"].includes(error.code)) return Object.freeze({ available: false, code: "REMOTE_MISSING", message: publicMessages.REMOTE_MISSING, branch });
      throw error;
    }
    let githubRemote = null;
    for (const name of remoteNames) {
      const url = (await this.command("git", ["remote", "get-url", name], cwd, "COMMAND_FAILED")).stdout.trim();
      try {
        githubRemote = { name, slug: normalizeGitHubRepository(url) };
        break;
      } catch {
        // Non-GitHub remotes remain untouched and are not connection candidates.
      }
    }
    if (!githubRemote) return Object.freeze({ available: false, code: "REMOTE_MISSING", message: publicMessages.REMOTE_MISSING, branch });
    let repository;
    try {
      repository = parseJson((await this.command("gh", ["repo", "view", githubRemote.slug, "--json", "name,isPrivate,defaultBranchRef"], cwd, "REPOSITORY_INVALID")).stdout, "REPOSITORY_INVALID");
    } catch (error) {
      if (error instanceof GitHubCliError && error.code === "REPOSITORY_INVALID") {
        return Object.freeze({ available: false, code: error.code, message: error.message, branch });
      }
      throw error;
    }
    const name = projectionText(repository.name, 100, "");
    if (!name) return Object.freeze({ available: false, code: "REPOSITORY_INVALID", message: publicMessages.REPOSITORY_INVALID, branch });
    const defaultBranch = validBranch(repository.defaultBranchRef?.name) ? repository.defaultBranchRef.name : null;
    const pullRequest = await this.optionalPullRequest(cwd, githubRemote.slug);
    return Object.freeze({
      available: true,
      repository: Object.freeze({ name, private: repository.isPrivate === true, defaultBranch }),
      remote: githubRemote.name,
      branch,
      pullRequest
    });
  }

  async connect(workspacePath, value) {
    const cwd = resolve(workspacePath);
    const repositorySlug = normalizeGitHubRepository(value?.repository);
    await this.command("gh", ["--version"], this.globalCwd, "CLI_MISSING");
    await this.command("gh", ["auth", "status", "--hostname", "github.com"], this.globalCwd, "COMMAND_FAILED");
    await this.command("git", ["rev-parse", "--git-dir"], cwd, "REPOSITORY_INVALID");
    await this.command("gh", ["repo", "view", repositorySlug, "--json", "name"], cwd, "REPOSITORY_INVALID");
    const remoteNames = (await this.command("git", ["remote"], cwd, "REMOTE_MISSING")).stdout.split(/\r?\n/).map((name) => name.trim());
    if (remoteNames.includes("github")) throw new GitHubCliError("CONFLICT");
    await this.command("git", ["remote", "add", "github", `https://github.com/${repositorySlug}.git`], cwd, "COMMAND_FAILED");
    try {
      const state = await this.inspect(cwd);
      if (!state.available) throw new GitHubCliError(state.code);
      return state;
    } catch (error) {
      try { await this.command("git", ["remote", "remove", "github"], cwd, "COMMAND_FAILED"); } catch {}
      throw error;
    }
  }

  async push(workspacePath) {
    const state = await this.inspect(workspacePath);
    if (!state.available) throw new GitHubCliError(state.code);
    await this.command("git", ["push", "--set-upstream", state.remote, state.branch], workspacePath, "COMMAND_FAILED");
    return this.inspect(workspacePath);
  }

  async createPullRequest(workspacePath, value = {}) {
    const state = await this.inspect(workspacePath);
    if (!state.available) throw new GitHubCliError(state.code);
    if (state.pullRequest) throw new GitHubCliError("CONFLICT");
    const title = boundedText(value.title, 200, true);
    const body = boundedText(value.body, 8_000);
    const base = boundedText(value.base || state.repository.defaultBranch, 80, true);
    if (!validBranch(base)) throw new GitHubCliError("COMMAND_FAILED");
    const args = ["pr", "create", "--title", title, "--base", base, "--body", body];
    await this.command("gh", args, workspacePath, "COMMAND_FAILED");
    const refreshed = await this.inspect(workspacePath);
    if (!refreshed.available || !refreshed.pullRequest) throw new GitHubCliError("COMMAND_FAILED");
    return refreshed;
  }
}
