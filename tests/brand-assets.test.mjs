import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

import { APP_BRAND } from "../desktop/brand.mjs";

const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const desktopSource = await readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8");
const iconBuildSource = await readFile(new URL("../desktop/assets/build_icon.py", import.meta.url), "utf8");

test("one canonical CodePilot mark drives the renderer brand and favicon", async () => {
  const png = await readFile(APP_BRAND.canonicalMarkPath);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1254);
  assert.equal(png.readUInt32BE(20), 1254);
  assert.equal(png[25], 6, "canonical PNG must retain RGBA transparency");
  assert.match(indexHtml, /class="brand-mark" src="\/assets\/codepilot-mark\.png"/);
  assert.match(indexHtml, /rel="icon"[^>]*href="\/assets\/codepilot-mark\.png"/);
  assert.doesNotMatch(indexHtml, /class="brand-mark">C</);
});

test("the Electron shell owns native application identity and its ICO derivative", async () => {
  await access(APP_BRAND.windowIconPath);
  const ico = await readFile(APP_BRAND.windowIconPath);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.ok(ico.readUInt16LE(4) >= 7);
  assert.equal(APP_BRAND.appUserModelId, "com.codepilot.desktop");
  assert.match(desktopSource, /app\.setAppUserModelId\(APP_BRAND\.appUserModelId\)/);
  assert.match(desktopSource, /icon:\s*APP_BRAND\.windowIconPath/);
  assert.match(iconBuildSource, /DESKTOP_SAFE_AREA_RATIO = 0\.10/);
  assert.match(iconBuildSource, /CANONICAL_MARK/);
});
