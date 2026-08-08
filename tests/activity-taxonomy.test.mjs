import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_SCHEMA_VERSION,
  TOOL_ACTIVITY_TAXONOMY,
  resolveActivityTaxonomy
} from "../public/activity-taxonomy.js";

const currentTools = [
  "Agent", "Bash", "BrowserClick", "BrowserInspect", "BrowserNavigate", "BrowserNewPage",
  "BrowserScreenshot", "BrowserStart", "BrowserType", "BrowserWait", "ComputerClick",
  "ComputerInspect", "ComputerKeypress", "ComputerListWindows", "ComputerScreenshot",
  "ComputerSetValue", "ComputerStart", "CreateDirectory", "Delete", "Edit", "InteractionClose",
  "ListFiles", "PreviewArtifact", "Read", "Search", "Write", "UpdateTodoList"
];

test("activity taxonomy covers every current registry and SDK bookkeeping tool", () => {
  assert.equal(ACTIVITY_SCHEMA_VERSION, 2);
  for (const tool of currentTools) {
    assert.ok(TOOL_ACTIVITY_TAXONOMY[tool], `missing taxonomy for ${tool}`);
    assert.notEqual(resolveActivityTaxonomy(tool).semanticKey, "generic.dynamic_tool");
  }
});

test("activity taxonomy recognizes MCP tools and diagnoses unknown dynamic tools", () => {
  assert.equal(resolveActivityTaxonomy("mcp__docs__search").semanticKey, "mcp.call");
  assert.deepEqual(resolveActivityTaxonomy("ProviderFutureTool").diagnostic, {
    code: "ACTIVITY_TAXONOMY_MISS",
    tool: "ProviderFutureTool"
  });
});

test("explicit tool contract activity descriptors outrank the built-in catalog", () => {
  assert.deepEqual(resolveActivityTaxonomy("Read", {
    semanticKey: "review.inspect",
    family: "review",
    action: "inspect"
  }), {
    semanticKey: "review.inspect",
    family: "review",
    action: "inspect",
    coverage: "explicit"
  });
});

