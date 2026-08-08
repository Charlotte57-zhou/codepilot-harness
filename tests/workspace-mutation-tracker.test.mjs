import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotWorkspace, diffWorkspaceSnapshots } from "../src/workspace-mutation-tracker.mjs";

test("workspace snapshots project text changes into reversible file records", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-mutation-"));
  await writeFile(join(root, "a.txt"), "before", "utf8");
  const before = await snapshotWorkspace(root);
  await writeFile(join(root, "a.txt"), "after", "utf8");
  await writeFile(join(root, "b.txt"), "new", "utf8");
  const diff = diffWorkspaceSnapshots(before, await snapshotWorkspace(root));
  assert.deepEqual(diff.fileChanges.map((change) => change.path), ["a.txt", "b.txt"]);
  assert.equal(diff.fileChanges[0].before.content, "before");
  assert.equal(diff.fileChanges[0].after.content, "after");
});
