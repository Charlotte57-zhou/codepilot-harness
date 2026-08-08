import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createFileChange, projectRunFileChanges, revertRunFileChanges } from "../src/file-change-service.mjs";

function completed(runId, toolCallId, fileChange) {
  return { type: "tool_completed", data: { runId, toolCallId, ok: true, metadata: { fileChange } } };
}

test("projects repeated edits as one run-owned file change", () => {
  const events = [
    completed("run-1", "a", createFileChange({ path: "a.txt", operation: "edit", beforeContent: "one", afterContent: "two" })),
    completed("run-1", "b", createFileChange({ path: "a.txt", operation: "edit", beforeContent: "two", afterContent: "three" }))
  ];
  const projected = projectRunFileChanges(events, "run-1");
  assert.equal(projected.files.length, 1);
  assert.equal(projected.files[0].before.content, "one");
  assert.equal(projected.files[0].after.content, "three");
});

test("projects SDK workspace mutation observations through the same run change owner", () => {
  const fileChange = createFileChange({
    path: "sdk.txt", operation: "create", beforeExists: false, afterContent: "created"
  });
  const projected = projectRunFileChanges([{
    type: "workspace_mutation_observed",
    data: { runId: "run-1", sourceToolCallIds: ["write-1"], fileChanges: [fileChange] }
  }], "run-1");
  assert.equal(projected.files[0].path, "sdk.txt");
  assert.deepEqual(projected.files[0].records[0].sourceToolCallIds, ["write-1"]);
});

test("revert verifies the final hash then restores the earliest preimage", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-changes-"));
  await writeFile(join(workspaceRoot, "a.txt"), "three", "utf8");
  const events = [
    completed("run-1", "a", createFileChange({ path: "a.txt", operation: "edit", beforeContent: "one", afterContent: "two" })),
    completed("run-1", "b", createFileChange({ path: "a.txt", operation: "edit", beforeContent: "two", afterContent: "three" }))
  ];
  await revertRunFileChanges({ events, runId: "run-1", workspaceRoot });
  assert.equal(await readFile(join(workspaceRoot, "a.txt"), "utf8"), "one");
});

test("revert preserves user edits made after the agent change", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-changes-"));
  await writeFile(join(workspaceRoot, "a.txt"), "user edit", "utf8");
  const events = [
    completed("run-1", "a", createFileChange({ path: "a.txt", operation: "edit", beforeContent: "one", afterContent: "two" }))
  ];
  await assert.rejects(
    revertRunFileChanges({ events, runId: "run-1", workspaceRoot }),
    /changed after the agent edit/
  );
  assert.equal(await readFile(join(workspaceRoot, "a.txt"), "utf8"), "user edit");
});
