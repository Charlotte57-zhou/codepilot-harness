import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [html, app, css] = await Promise.all([
  readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  readFile(new URL("../public/styles.css", import.meta.url), "utf8")
]);

test("advanced settings expose the complete run budget policy", () => {
  for (const id of [
    "budget-max-turns",
    "budget-max-retries",
    "budget-deadline-minutes",
    "budget-max-output-tokens",
    "budget-compaction-output-tokens",
    "budget-effective-output"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /新设置只影响下一次任务/);
  assert.match(html, /输出上限会再受当前模型能力限制/);
});

test("budget form round-trips values through the server-owned runtime config", () => {
  assert.match(app, /budgets:\s*\{/);
  assert.match(app, /maxTurns:\s*Number\(elements\.budgetMaxTurns\.value\)/);
  assert.match(app, /deadlineMs:\s*Number\(elements\.budgetDeadlineMinutes\.value\) \* 60_000/);
  assert.match(app, /config\.budgetPolicy/);
  assert.match(css, /\.budget-settings-grid/);
  assert.match(css, /overflow-y:\s*auto/);
});

