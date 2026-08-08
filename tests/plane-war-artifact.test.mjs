import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../demo-repo/games/plane-war/index.html", import.meta.url), "utf8");

test("plane war shows only the active lifecycle overlay", () => {
  assert.match(html, /\.overlay\s*\{[^}]*opacity:\s*0[^}]*visibility:\s*hidden/s);
  assert.match(html, /\.overlay\.active\s*\{[^}]*opacity:\s*1[^}]*visibility:\s*visible/s);
  assert.match(html, /id="startOverlay"/);
  assert.match(html, /id="endOverlay"/);
});

test("plane war has one animation owner instead of racing idle and game loops", () => {
  assert.match(html, /requestAnimationFrame\(gameLoop\)/);
  assert.doesNotMatch(html, /idleRender|requestAnimationFrame\(idleRender\)/);
});
