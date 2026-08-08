import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { GitWorkspaceService, parseWorktreePorcelain } from "../desktop/git-workspace-service.mjs";

const run = promisify(execFile);

async function fixtureRepository() {
  const root = await mkdtemp(join(tmpdir(), "codepilot-worktree-"));
  const repository = join(root, "repository");
  await run("git", ["init", repository], { windowsHide: true });
  await writeFile(join(repository, "README.md"), "fixture\n", "utf8");
  await run("git", ["-C", repository, "add", "README.md"], { windowsHide: true });
  await run("git", ["-C", repository, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "initial"], { windowsHide: true });
  return { root, repository };
}

test("git worktree porcelain parser preserves structured records", () => {
  const records = parseWorktreePorcelain("worktree C:/repo\0HEAD abc\0branch refs/heads/main\0\0worktree C:/tree\0HEAD def\0detached\0\0");
  assert.deepEqual(records, [
    { path: "C:/repo", head: "abc", branch: "main" },
    { path: "C:/tree", head: "def", detached: true }
  ]);
});

test("git workspace service creates, inspects, and safely removes a clean permanent worktree", async () => {
  const { root, repository } = await fixtureRepository();
  const service = new GitWorkspaceService();
  const targetPath = join(root, "feature-tree");
  const created = await service.createPermanent({
    workspacePath: repository,
    targetPath,
    branch: "codepilot/feature"
  });
  assert.equal(created.branch, "codepilot/feature");
  assert.match(created.baseCommit, /^[a-f0-9]{40,64}$/);
  assert.equal((await service.inspect(targetPath)).available, true);

  await service.removePermanent({ repositoryPath: repository, worktreePath: targetPath, baseCommit: created.baseCommit });
  await assert.rejects(() => readFile(join(targetPath, "README.md"), "utf8"), /ENOENT/);
});

test("git workspace service blocks dirty and unpushed worktree removal and degrades for non-Git folders", async () => {
  const { root, repository } = await fixtureRepository();
  const service = new GitWorkspaceService();
  const targetPath = join(root, "guarded-tree");
  const created = await service.createPermanent({ workspacePath: repository, targetPath, branch: "codepilot/guarded" });

  await writeFile(join(targetPath, "untracked.txt"), "keep\n", "utf8");
  await assert.rejects(
    service.removePermanent({ repositoryPath: repository, worktreePath: targetPath, baseCommit: created.baseCommit }),
    (error) => error.code === "WORKTREE_DIRTY"
  );
  await run("git", ["-C", targetPath, "add", "untracked.txt"], { windowsHide: true });
  await run("git", ["-C", targetPath, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-m", "worktree commit"], { windowsHide: true });
  await assert.rejects(
    service.removePermanent({ repositoryPath: repository, worktreePath: targetPath, baseCommit: created.baseCommit }),
    (error) => error.code === "WORKTREE_UNPUSHED"
  );
  assert.deepEqual(await service.inspect(root), { available: false, reason: "This Project is not a Git repository." });
});
