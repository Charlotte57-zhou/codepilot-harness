import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("run trace selection retains normalized task facts used by task ordinal projection", () => {
  const traceEventTypes = appSource.match(/const traceEventTypes = new Set\(\[(.*?)\]\);/s)?.[1] ?? "";
  assert.match(traceEventTypes, /"task_progress_changed"/);
});
