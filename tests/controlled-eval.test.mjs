import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { controlledCases } from "../evaluation/cases.mjs";
import { snapshotTree, validateCase, writeFixture } from "../evaluation/lib.mjs";
import { renderComparisonMarkdown, summarizeResults } from "../evaluation/report.mjs";

test("controlled cases have unique ids, bounded change scopes, and runnable fixture commands", () => {
  assert.equal(new Set(controlledCases.map((item) => item.id)).size, controlledCases.length);
  assert.equal(controlledCases.length, 6);
  for (const item of controlledCases) {
    assert.ok(item.prompt.length < 320);
    assert.ok(item.command.length >= 1);
    assert.ok(item.allowedChanges.every((path) => path in item.files));
    assert.ok(Object.keys(item.files).some((path) => path.startsWith("test/")));
  }
});

test("validator rejects test tampering even when the resulting command passes", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-eval-validator-"));
  const caseSpec = controlledCases[1];
  await writeFixture(root, caseSpec.files);
  const before = await snapshotTree(root);
  const testPath = join(root, "test", "page-size.test.mjs");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(testPath, "import test from 'node:test'; test('fake',()=>{});\n"));
  const result = await validateCase(caseSpec, root, before, "done");
  assert.equal(result.scopePassed, false);
  assert.equal(result.passed, false);
});

test("controlled runner keeps secret values out of normalized source artifacts", async () => {
  const source = await readFile(new URL("../evaluation/run-controlled.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /console\.log\([^\n]*(AUTH_TOKEN|API_KEY)/);
  assert.match(source, /--no-session-persistence/);
  assert.match(source, /flag: "wx"/);
});

test("normalized report separates adapter correctness and renders the frozen claim boundary", () => {
  const results = [
    { adapter: "codepilot", durationMs: 30, validation: { passed: true } },
    { adapter: "codepilot", durationMs: 10, validation: { passed: false } },
    { adapter: "claude-cli", durationMs: 20, validation: { passed: true } }
  ];
  const byAdapter = summarizeResults(results, ["codepilot", "claude-cli"]);
  assert.deepEqual(byAdapter.codepilot, { passed: 1, total: 2, passRate: 0.5, medianDurationMs: 30 });
  const markdown = renderComparisonMarkdown({ architectureFreeze: "fixture", model: "deepseek-v4-flash", byAdapter, results: [] }, []);
  assert.match(markdown, /not a claim of production superiority/);
});
