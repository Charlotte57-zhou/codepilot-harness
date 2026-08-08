import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findBrokenLocalLinks, findStaleContextClaims } from "../scripts/context-check.mjs";

test("context link check resolves links relative to their owning document", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-context-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "README.md"), "[Current](docs/CURRENT.md)\n", "utf8");
  await writeFile(join(root, "docs", "CURRENT.md"), "[Missing](NOPE.md)\n", "utf8");
  const broken = await findBrokenLocalLinks(root, [join(root, "README.md"), join(root, "docs", "CURRENT.md")]);
  assert.deepEqual(broken, [{ file: "docs/CURRENT.md", destination: "NOPE.md" }]);
});

test("canonical context documents reject removed owners and stale baselines", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-context-stale-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "README.md"), "SessionAggregate 单写入者\n", "utf8");
  await writeFile(join(root, "docs", "CURRENT_STATE.md"), "226/227\n", "utf8");
  await writeFile(join(root, "docs", "PROJECT_MEMORY.md"), "Git work tree 元数据需要先修复\n", "utf8");
  assert.deepEqual((await findStaleContextClaims(root)).map(({ rule }) => rule), [
    "removed-runtime-owner",
    "stale-test-baseline",
    "stale-git-state"
  ]);
});
