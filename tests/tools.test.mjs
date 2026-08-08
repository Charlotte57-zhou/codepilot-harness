import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { buildTool } from "../src/tools/tool-contract.mjs";
import { createCodePilotToolRegistry } from "../src/tools/codepilot-tool-registry.mjs";
import { ToolRegistry } from "../src/tools/tool-registry.mjs";
import { toolSuccess } from "../src/tools/tool-result.mjs";

test("CodePilot registry contains only SDK extension capabilities", () => {
  const registry = createCodePilotToolRegistry();
  assert.deepEqual(registry.list().map((tool) => tool.name), ["PreviewArtifact"]);
  assert.equal(registry.get("Read"), undefined);
  assert.equal(registry.get("Bash"), undefined);
});

test("ToolRegistry validates input and bounds extension output", async () => {
  let calls = 0;
  const registry = new ToolRegistry([buildTool({
    name: "Probe",
    description: "Probe",
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    maxResultSizeChars: 80,
    async call() {
      calls += 1;
      return toolSuccess("a".repeat(200));
    }
  })]);
  const invalid = await registry.execute("Probe", { value: "" }, {});
  assert.equal(invalid.error.code, "SCHEMA_VALIDATION_FAILED");
  assert.equal(calls, 0);
  const valid = await registry.execute("Probe", { value: "x" }, {});
  assert.equal(valid.ok, true);
  assert.equal(valid.content.length, 80);
  assert.equal(valid.metadata.truncated, true);
});

test("PreviewArtifact keeps workspace and preview-origin guards outside the SDK", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-preview-tool-"));
  await writeFile(join(root, "index.html"), "<h1>demo</h1>", "utf8");
  const registry = createCodePilotToolRegistry();
  const result = await registry.execute("PreviewArtifact", { path: "index.html" }, {
    workspaceRoot: root,
    workspacePreviewOrigin: "http://127.0.0.1:43123"
  });
  assert.equal(result.ok, true);
  assert.match(result.content, /http:\/\/127\.0\.0\.1:43123\/preview\/index\.html/);
  const escaped = await registry.execute("PreviewArtifact", { path: "../secret.html" }, {
    workspaceRoot: root,
    workspacePreviewOrigin: "http://127.0.0.1:43123"
  });
  assert.equal(escaped.ok, false);
});
