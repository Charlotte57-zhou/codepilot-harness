import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("quick model settings derive reasoning controls from the selected model profile", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");
  assert.match(source, /catalog\?\.modelProfiles\?\.\[selectedModel\]/);
  assert.match(source, /config\.effectiveReasoning\?\.effort/);
  assert.match(source, /reasoningEffortLabel/);
  assert.match(styles, /\.quick-setting-row\[hidden\]\s*\{\s*display:\s*none/);
});
