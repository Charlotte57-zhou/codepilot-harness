import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectRegistry, projectIdForPath } from "../desktop/project-registry.mjs";
import { sessionDirectoryForStateRoot } from "../src/session-store.mjs";
import { workspaceTargetIdForPath } from "../src/workspace-target-identity.mjs";

test("project registry persists a selected workspace without duplicating the same directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-projects-"));
  const defaultWorkspace = join(root, "demo");
  const secondWorkspace = join(root, "business-app");
  await mkdir(defaultWorkspace);
  await mkdir(secondWorkspace);
  let tick = 0;
  const now = () => `2026-08-04T00:00:0${tick++}.000Z`;
  const registryPath = join(root, "user-data", "projects.json");
  const registry = new ProjectRegistry({ registryPath, defaultWorkspacePath: defaultWorkspace, now });
  const initial = await registry.load();
  const added = await registry.add(secondWorkspace, { name: "Business App" });
  assert.equal((await registry.add(secondWorkspace)).id, added.id);
  assert.equal(added.name, "Business App");
  await registry.select(added.id);

  const reloaded = new ProjectRegistry({ registryPath, defaultWorkspacePath: defaultWorkspace, now });
  const snapshot = await reloaded.load();
  assert.equal(snapshot.projects.length, 2);
  assert.equal(snapshot.defaultProjectId, initial.defaultProjectId);
  assert.equal(reloaded.current().id, added.id);
  assert.equal(JSON.parse(await readFile(registryPath, "utf8")).selectedProjectId, added.id);
  assert.equal(snapshot.schemaVersion, 3);
  assert.equal(added.targets.length, 1);
  assert.equal(added.targets[0].id, workspaceTargetIdForPath(added.workspacePath));
});

test("project registry rejects pre-v3 records instead of migrating them", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-project-v3-"));
  const defaultWorkspace = join(root, "demo");
  const projectWorkspace = join(root, "project");
  await mkdir(defaultWorkspace);
  await mkdir(projectWorkspace);
  const registryPath = join(root, "projects.json");
  const projectId = projectIdForPath(projectWorkspace);
  await import("node:fs/promises").then(({ writeFile }) => writeFile(registryPath, JSON.stringify({
    schemaVersion: 2,
    selectedProjectId: projectId,
    projects: [{ id: projectId, name: "Old schema", workspacePath: projectWorkspace }]
  }), "utf8"));

  const registry = new ProjectRegistry({ registryPath, defaultWorkspacePath: defaultWorkspace });
  await assert.rejects(() => registry.load(), /Unsupported Project registry schema: 2/);
});

test("project registry persists current project and worktree lifecycle metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-project-current-"));
  const defaultWorkspace = join(root, "demo");
  const projectWorkspace = join(root, "project");
  const worktreeWorkspace = join(root, "project-worktree");
  await mkdir(defaultWorkspace);
  await mkdir(projectWorkspace);
  await mkdir(worktreeWorkspace);
  const registry = new ProjectRegistry({ registryPath: join(root, "projects.json"), defaultWorkspacePath: defaultWorkspace });
  await registry.load();
  const project = await registry.add(projectWorkspace, { name: "Current" });
  const projectId = project.id;

  await registry.rename(projectId, "Renamed");
  await registry.setPinned(projectId, true);
  const target = await registry.addTarget(projectId, {
    workspacePath: worktreeWorkspace,
    branch: "codepilot/fixture",
    baseCommit: "abc123"
  });
  await registry.select(projectId, target.id);
  assert.equal(registry.current().name, "Renamed");
  assert.equal(registry.current().pinned, true);
  assert.equal(registry.snapshot().projects[0].id, projectId);
  assert.equal(registry.snapshot().selectedTargetId, target.id);

  await registry.removeTarget(projectId, target.id);
  assert.equal(registry.get(projectId).targets.length, 1);
  assert.equal(registry.snapshot().selectedTargetId, registry.get(projectId).targets[0].id);
  await registry.remove(projectId);
  assert.equal(registry.get(projectId), undefined);
  assert.equal(registry.snapshot().selectedProjectId, registry.snapshot().defaultProjectId);
});

test("project registry rejects an empty explicit project name", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-project-name-"));
  const defaultWorkspace = join(root, "demo");
  const projectWorkspace = join(root, "project");
  await mkdir(defaultWorkspace);
  await mkdir(projectWorkspace);
  const registry = new ProjectRegistry({ registryPath: join(root, "projects.json"), defaultWorkspacePath: defaultWorkspace });
  await registry.load();
  await assert.rejects(() => registry.add(projectWorkspace, { name: "   " }), /non-empty string/);
});

test("project identity and task journal namespace are stable and project-scoped", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-project-scope-"));
  const one = join(root, "one");
  const two = join(root, "two");
  assert.notEqual(projectIdForPath(one), projectIdForPath(two));
  assert.notEqual(sessionDirectoryForStateRoot(one), sessionDirectoryForStateRoot(two));
  assert.match(sessionDirectoryForStateRoot(one), /\.codepilot[\\/]sessions$/);
});
