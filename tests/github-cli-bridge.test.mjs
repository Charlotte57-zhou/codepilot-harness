import test from "node:test";
import assert from "node:assert/strict";
import { GitHubCliBridge, GitHubCliError, classifyGitHubCommandError, normalizeGitHubRepository } from "../desktop/github-cli-bridge.mjs";

function scriptedRunner(steps) {
  const calls = [];
  const runner = async (command, args, options) => {
    calls.push({ command, args, options });
    const step = steps.shift();
    assert.ok(step, `Unexpected command: ${command} ${args.join(" ")}`);
    assert.equal(`${command} ${args.join(" ")}`, step.command);
    if (step.error) throw step.error;
    return { stdout: step.stdout ?? "", stderr: step.stderr ?? "" };
  };
  return { runner, calls };
}

const stateSteps = ({ pullRequest = true } = {}) => [
  { command: "gh --version", stdout: "gh version 2" },
  { command: "gh auth status --hostname github.com" },
  { command: "git rev-parse --abbrev-ref HEAD", stdout: "feature/bridge\n" },
  { command: "git remote", stdout: "github\n" },
  { command: "git remote get-url github", stdout: "https://github.com/sample-owner/sample-repo.git\n" },
  { command: "gh repo view sample-owner/sample-repo --json name,isPrivate,defaultBranchRef", stdout: JSON.stringify({ name: "sample-repo", isPrivate: true, defaultBranchRef: { name: "main" }, owner: { login: "ACCOUNT_VALUE" }, url: "REMOTE_VALUE" }) },
  pullRequest
    ? { command: "gh pr view --repo sample-owner/sample-repo --json number,title,state,headRefName,baseRefName,statusCheckRollup", stdout: JSON.stringify({ number: 7, title: "Bridge", state: "OPEN", headRefName: "feature/bridge", baseRefName: "main", url: "REMOTE_VALUE", statusCheckRollup: [{ name: "unit", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "REMOTE_VALUE" }] }) }
    : { command: "gh pr view --repo sample-owner/sample-repo --json number,title,state,headRefName,baseRefName,statusCheckRollup", error: { stderr: "no pull requests found for branch" } }
];

test("GitHub bridge projects repository, branch, PR and checks without raw identity fields", async () => {
  const script = scriptedRunner(stateSteps());
  const state = await new GitHubCliBridge({ runner: script.runner }).inspect(".");
  assert.deepEqual(state, {
    available: true,
    repository: { name: "sample-repo", private: true, defaultBranch: "main" },
    remote: "github",
    branch: "feature/bridge",
    pullRequest: { number: 7, title: "Bridge", state: "open", headBranch: "feature/bridge", baseBranch: "main", checks: [{ name: "unit", state: "success", bucket: "pass" }] }
  });
  const projection = JSON.stringify(state);
  assert.doesNotMatch(projection, /ACCOUNT_VALUE|REMOTE_VALUE|stdout|stderr|login|url/i);
  assert.ok(state.pullRequest.title.length <= 200);
  assert.ok(state.pullRequest.checks.every((check) => check.name.length <= 120 && check.state.length <= 40));
  assert.ok(script.calls.every((call) => call.options.cwd && !call.args.includes(call.options.cwd)));
});

test("GitHub bridge returns bounded setup states for missing CLI, auth and origin", async () => {
  const missing = scriptedRunner([{ command: "gh --version", error: { code: "ENOENT" } }]);
  assert.deepEqual(await new GitHubCliBridge({ runner: missing.runner }).inspect("."), {
    available: false,
    code: "CLI_MISSING",
    message: "请先安装 GitHub CLI，再连接这个项目。"
  });

  const auth = scriptedRunner([
    { command: "gh --version" },
    { command: "gh auth status --hostname github.com", error: { stderr: "not logged into any accounts" } }
  ]);
  assert.equal((await new GitHubCliBridge({ runner: auth.runner }).inspect(".")).code, "AUTH_REQUIRED");

  const detached = scriptedRunner([
    { command: "gh --version" },
    { command: "gh auth status --hostname github.com" },
    { command: "git rev-parse --abbrev-ref HEAD", stdout: "HEAD" }
  ]);
  assert.equal((await new GitHubCliBridge({ runner: detached.runner }).inspect(".")).code, "REPOSITORY_INVALID");

  const remote = scriptedRunner([
    { command: "gh --version" },
    { command: "gh auth status --hostname github.com" },
    { command: "git rev-parse --abbrev-ref HEAD", stdout: "main" },
    { command: "git remote", stdout: "" }
  ]);
  assert.deepEqual(await new GitHubCliBridge({ runner: remote.runner }).inspect("."), {
    available: false,
    code: "REMOTE_MISSING",
    message: "当前 Git 仓库还没有连接 GitHub 仓库。",
    branch: "main"
  });

  const invalid = scriptedRunner([
    { command: "gh --version" },
    { command: "gh auth status --hostname github.com" },
    { command: "git rev-parse --abbrev-ref HEAD", stdout: "main" },
    { command: "git remote", stdout: "origin" },
    { command: "git remote get-url origin", stdout: "https://github.com/sample-owner/sample-repo.git" },
    { command: "gh repo view sample-owner/sample-repo --json name,isPrivate,defaultBranchRef", error: { stderr: "repository not found" } }
  ]);
  assert.deepEqual(await new GitHubCliBridge({ runner: invalid.runner }).inspect("."), {
    available: false,
    code: "REPOSITORY_INVALID",
    message: "GitHub 未识别当前仓库。",
    branch: "main"
  });
});

test("GitHub command failures distinguish permission, network and conflict without exposing stderr", () => {
  assert.equal(classifyGitHubCommandError({ stderr: "HTTP 403 resource not accessible" }), "PERMISSION_DENIED");
  assert.equal(classifyGitHubCommandError({ stderr: "could not resolve host" }), "NETWORK_FAILED");
  assert.equal(classifyGitHubCommandError({ stderr: "rejected non-fast-forward" }), "CONFLICT");
  const error = new GitHubCliError("PERMISSION_DENIED");
  assert.equal(error.message, "当前 GitHub 身份没有完成此操作的权限。");
  assert.doesNotMatch(error.message, /403|stderr/i);
});

test("push uses the inspected branch and create PR accepts only bounded structured fields", async () => {
  const pushScript = scriptedRunner([
    ...stateSteps({ pullRequest: false }),
    { command: "git push --set-upstream github feature/bridge" },
    ...stateSteps({ pullRequest: false })
  ]);
  const pushed = await new GitHubCliBridge({ runner: pushScript.runner }).push(".");
  assert.equal(pushed.branch, "feature/bridge");

  const createScript = scriptedRunner([
    ...stateSteps({ pullRequest: false }),
    { command: "gh pr create --title Add bridge --base main --body Body" },
    ...stateSteps({ pullRequest: true })
  ]);
  const created = await new GitHubCliBridge({ runner: createScript.runner }).createPullRequest(".", { title: "Add bridge", base: "main", body: "Body" });
  assert.equal(created.pullRequest.number, 7);
  await assert.rejects(() => new GitHubCliBridge({ runner: async () => ({ stdout: "" }) }).createPullRequest(".", { title: "x".repeat(201) }), GitHubCliError);
});

test("repository binding validates input, keeps existing remotes and returns verified state", async () => {
  assert.equal(normalizeGitHubRepository("https://github.com/sample-owner/sample-repo.git"), "sample-owner/sample-repo");
  assert.equal(normalizeGitHubRepository("sample-owner/sample-repo"), "sample-owner/sample-repo");
  assert.throws(() => normalizeGitHubRepository("https://example.test/repo"), GitHubCliError);

  const script = scriptedRunner([
    { command: "gh --version" },
    { command: "gh auth status --hostname github.com" },
    { command: "git rev-parse --git-dir", stdout: ".git" },
    { command: "gh repo view sample-owner/sample-repo --json name", stdout: JSON.stringify({ name: "sample-repo" }) },
    { command: "git remote", stdout: "origin\n" },
    { command: "git remote add github https://github.com/sample-owner/sample-repo.git" },
    ...stateSteps({ pullRequest: false })
  ]);
  const state = await new GitHubCliBridge({ runner: script.runner }).connect(".", { repository: "sample-owner/sample-repo" });
  assert.equal(state.available, true);
  assert.equal(state.remote, "github");
});
