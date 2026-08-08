import assert from "node:assert/strict";
import { test } from "node:test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectPublicSourceFiles,
  publicExcludedPrefixes,
  publicRequiredFiles
} from "../scripts/public-release-contract.mjs";
import { verifyPublicPrivacy } from "../scripts/privacy-check.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("public release is an explicit current local-only allowlist", async () => {
  const files = await collectPublicSourceFiles(root);
  for (const required of publicRequiredFiles) assert.ok(files.includes(required), required);
  assert.ok(files.includes("docs/ARCHITECTURE.md"));
  assert.ok(files.includes("demo-repo/.codepilot/skills/harness-audit/SKILL.md"));
  assert.ok(!files.includes("AGENTS.md"));
  assert.ok(!files.includes("docs/PROJECT_MEMORY.md"));
  assert.ok(!files.some((path) => path.startsWith("deployment/")));
  assert.ok(!files.some((path) => publicExcludedPrefixes.some((prefix) => path.startsWith(prefix))));
});

test("public source allowlist passes privacy policy", async () => {
  const result = await verifyPublicPrivacy(root);
  assert.ok(result.files > 100);
});
