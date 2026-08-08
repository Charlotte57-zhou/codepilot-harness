import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateSdkBuiltInToolInput } from "../src/sdk-built-in-tool-policy.mjs";

test("SDK built-in filesystem policy accepts current in-workspace paths", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-policy-"));
  await writeFile(join(workspaceRoot, "app.js"), "export {};\n", "utf8");

  assert.equal((await validateSdkBuiltInToolInput("Read", { file_path: "app.js" }, workspaceRoot)).behavior, "allow");
  assert.equal((await validateSdkBuiltInToolInput("Grep", { pattern: "export" }, workspaceRoot)).behavior, "allow");
  assert.equal((await validateSdkBuiltInToolInput("Write", { file_path: "new.js", content: "" }, workspaceRoot)).behavior, "allow");
  assert.equal((await validateSdkBuiltInToolInput("Bash", { command: "npm test" }, workspaceRoot)).behavior, "allow");
});

test("SDK built-in filesystem policy denies traversal and absolute outside paths", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-policy-root-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-policy-outside-"));
  await writeFile(join(outsideRoot, "secret.txt"), "secret", "utf8");

  const traversal = await validateSdkBuiltInToolInput("Read", { file_path: "../secret.txt" }, workspaceRoot);
  const absolute = await validateSdkBuiltInToolInput("Write", { file_path: join(outsideRoot, "new.txt") }, workspaceRoot);
  assert.equal(traversal.behavior, "deny");
  assert.equal(traversal.details.code, "PATH_OUTSIDE_WORKSPACE");
  assert.equal(absolute.behavior, "deny");
  assert.equal(absolute.details.code, "PATH_OUTSIDE_WORKSPACE");
});

test("SDK built-in filesystem policy rejects a symlink that resolves outside", async (t) => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-policy-link-root-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-policy-link-outside-"));
  try {
    await symlink(outsideRoot, join(workspaceRoot, "linked"), process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES"].includes(error?.code)) return t.skip("symlink creation is unavailable");
    throw error;
  }
  await writeFile(join(outsideRoot, "secret.txt"), "secret", "utf8");
  const decision = await validateSdkBuiltInToolInput("Read", { file_path: "linked/secret.txt" }, workspaceRoot);
  assert.equal(decision.behavior, "deny");
  assert.equal(decision.details.code, "PATH_OUTSIDE_WORKSPACE");
});

test("SDK built-in filesystem policy rejects missing required paths", async () => {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "codepilot-sdk-policy-required-"));
  for (const [toolName, input] of [["Read", {}], ["Write", { content: "x" }], ["NotebookEdit", { new_source: "x" }]]) {
    const decision = await validateSdkBuiltInToolInput(toolName, input, workspaceRoot);
    assert.equal(decision.behavior, "deny");
    assert.equal(decision.details.code, "PATH_REQUIRED");
  }
});
