import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath } from "node:fs/promises";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
const branchPattern = /^[a-z0-9][a-z0-9._/-]{0,79}$/i;

function pathIdentity(value) {
  const normalized = resolve(value);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export class GitWorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GitWorkspaceError";
    this.code = code;
  }
}

async function git(cwd, args) {
  try {
    const result = await execFileAsync("git", ["-C", resolve(cwd), ...args], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });
    return result.stdout;
  } catch (error) {
    throw new GitWorkspaceError("GIT_COMMAND_FAILED", "Git could not complete this workspace operation.");
  }
}

export function parseWorktreePorcelain(value) {
  const records = [];
  let current = {};
  for (const entry of String(value).split("\0")) {
    if (!entry) {
      if (current.path) records.push(Object.freeze(current));
      current = {};
      continue;
    }
    const separator = entry.indexOf(" ");
    const key = separator === -1 ? entry : entry.slice(0, separator);
    const content = separator === -1 ? true : entry.slice(separator + 1);
    if (key === "worktree") current.path = content;
    else if (key === "HEAD") current.head = content;
    else if (key === "branch") current.branch = content.replace(/^refs\/heads\//, "");
    else if (key === "bare" || key === "detached" || key === "locked" || key === "prunable") current[key] = content;
  }
  if (current.path) records.push(Object.freeze(current));
  return Object.freeze(records);
}

export class GitWorkspaceService {
  async inspect(workspacePath) {
    try {
      const repositoryPath = (await git(workspacePath, ["rev-parse", "--show-toplevel"])).trim();
      const [status, worktrees] = await Promise.all([
        git(repositoryPath, ["status", "--porcelain=v2", "--branch", "-z"]),
        git(repositoryPath, ["worktree", "list", "--porcelain", "-z"])
      ]);
      const entries = status.split("\0").filter(Boolean);
      const branchPrefix = "# branch.head ";
      const upstreamPrefix = "# branch.upstream ";
      const branch = entries.find((entry) => entry.startsWith(branchPrefix))?.slice(branchPrefix.length) ?? null;
      const upstream = entries.find((entry) => entry.startsWith(upstreamPrefix))?.slice(upstreamPrefix.length) ?? null;
      const aheadBehind = entries.find((entry) => entry.startsWith("# branch.ab "))?.match(/\+(\d+) -(\d+)/);
      return Object.freeze({
        available: true,
        repositoryPath,
        branch,
        upstream,
        ahead: Number(aheadBehind?.[1] ?? 0),
        behind: Number(aheadBehind?.[2] ?? 0),
        dirty: entries.some((entry) => !entry.startsWith("# ")),
        worktrees: parseWorktreePorcelain(worktrees)
      });
    } catch {
      return Object.freeze({ available: false, reason: "This Project is not a Git repository." });
    }
  }

  async createPermanent({ workspacePath, targetPath, branch, baseRef = "HEAD" }) {
    if (!branchPattern.test(branch ?? "") || branch.includes("..") || branch.endsWith("/") || branch.includes("//")) {
      throw new GitWorkspaceError("INVALID_BRANCH", "Worktree branch must be a valid Git branch name.");
    }
    const inspected = await this.inspect(workspacePath);
    if (!inspected.available) throw new GitWorkspaceError("NOT_GIT", inspected.reason);
    const baseCommit = (await git(inspected.repositoryPath, ["rev-parse", "--verify", `${baseRef}^{commit}`])).trim();
    await git(inspected.repositoryPath, ["worktree", "add", "-b", branch, resolve(targetPath), baseCommit]);
    return Object.freeze({
      workspacePath: await realpath(resolve(targetPath)),
      branch,
      baseCommit
    });
  }

  async removePermanent({ repositoryPath, worktreePath, baseCommit }) {
    if (typeof baseCommit !== "string" || !/^[a-f0-9]{40,64}$/i.test(baseCommit)) {
      throw new GitWorkspaceError("INVALID_BASE", "The worktree base commit is unavailable.");
    }
    const inspected = await this.inspect(repositoryPath);
    if (!inspected.available) throw new GitWorkspaceError("NOT_GIT", inspected.reason);
    const canonical = await realpath(resolve(worktreePath)).catch(() => null);
    const registered = canonical && inspected.worktrees.find((item) => pathIdentity(item.path) === pathIdentity(canonical));
    if (!registered || pathIdentity(registered.path) === pathIdentity(inspected.repositoryPath)) {
      throw new GitWorkspaceError("WORKTREE_NOT_REGISTERED", "The selected workspace is not a removable Git worktree.");
    }
    const dirty = (await git(canonical, ["status", "--porcelain", "--untracked-files=normal"])).trim();
    if (dirty) throw new GitWorkspaceError("WORKTREE_DIRTY", "Commit or discard worktree changes before removing it.");
    const ahead = Number((await git(canonical, ["rev-list", "--count", `${baseCommit}..HEAD`])).trim());
    if (ahead > 0) throw new GitWorkspaceError("WORKTREE_UNPUSHED", "The worktree contains commits beyond its recorded base.");
    await git(inspected.repositoryPath, ["worktree", "remove", canonical]);
    return Object.freeze({ removed: true });
  }
}
