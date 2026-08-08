import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Electron owns bounded Project GitHub intents and checks active run before mutations", async () => {
  const [main, preload] = await Promise.all([read("../desktop/main.mjs"), read("../desktop/preload.cjs")]);
  assert.match(main, /new GitHubCliBridge\(\)/);
  assert.match(main, /codepilot:projects:github:state/);
  assert.match(main, /codepilot:projects:github:connect[^]*await assertProjectMutationAvailable\(\)/);
  assert.match(main, /codepilot:projects:github:push[^]*await assertProjectMutationAvailable\(\)/);
  assert.match(main, /codepilot:projects:github:create-pr[^]*await assertProjectMutationAvailable\(\)/);
  assert.match(main, /githubWorkspaceFor\(project\)/);
  assert.match(preload, /getProjectGitHubState\(projectId\)/);
  assert.match(preload, /connectProjectGitHubRepository\(projectId, repository\)/);
  assert.match(preload, /pushProjectGitHubBranch\(projectId\)/);
  assert.match(preload, /createProjectGitHubPullRequest\(projectId, value = \{\}\)/);
  assert.match(preload, /title: String\(value\.title[^]*\.slice\(0, 201\)/);
  assert.match(preload, /body: String\(value\.body[^]*\.slice\(0, 8001\)/);
  assert.doesNotMatch(preload, /workspacePath|stdout|stderr|token|login/);
});

test("Electron creates an isolated Git worktree before the renderer starts a new Task", async () => {
  const [main, preload, app] = await Promise.all([read("../desktop/main.mjs"), read("../desktop/preload.cjs"), read("../public/app.js")]);
  assert.match(main, /codepilot:projects:worktrees:create-isolated[^]*await assertProjectMutationAvailable\(\)[^]*gitWorkspaceService\.createPermanent[^]*projectRegistry\.addTarget/s);
  assert.match(main, /app\.getPath\("userData"\), "worktrees", project\.id/);
  assert.match(preload, /createIsolatedProjectWorktree\(projectId\)/);
  assert.match(app, /createIsolatedProjectWorktree\(project\.id\)[^]*newTask: true/s);
});

test("Project menu opens one GitHub workflow and confirms push and PR mutations", async () => {
  const [html, app, css] = await Promise.all([read("../public/index.html"), read("../public/app.js"), read("../public/styles.css")]);
  assert.match(app, /data-project-action="github">连接 GitHub/);
  assert.match(html, /id="github-dialog"[^]*id="github-status"[^]*id="github-connect-form"[^]*id="github-repository"[^]*id="github-checks"/);
  assert.match(html, /id="github-pr-form"[^]*id="github-pr-title"[^]*id="github-pr-base"[^]*id="github-pr-body"/);
  assert.match(app, /getProjectGitHubState\(projectId\)/);
  assert.match(app, /title: "连接这个 GitHub 仓库？"[^]*connectProjectGitHubRepository\(projectId, repository\)/);
  assert.match(app, /title: "Push 当前分支到 GitHub？"[^]*pushProjectGitHubBranch\(projectId\)/);
  assert.match(app, /title: "创建 Pull Request？"[^]*createProjectGitHubPullRequest\(projectId, value\)/);
  assert.match(app, /check\.bucket === "pass"/);
  assert.match(css, /\.github-repository\s*\{[^}]*grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(css, /\.github-check\[data-bucket="fail"\]/);
});

