import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { icon, iconNames } from "../public/icons.js";

const indexHtml = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("all interface icons come from the shared SVG icon registry", () => {
  assert.doesNotMatch(indexHtml, /<svg\b/);
  assert.doesNotMatch(appSource, /<svg\b/);

  const declared = new Set(iconNames);
  const staticNames = [...indexHtml.matchAll(/data-icon="([^"]+)"/g)].map((match) => match[1]);
  const dynamicNames = [...appSource.matchAll(/\bicon\("([^"]+)"\)/g)].map((match) => match[1]);
  for (const name of [...staticNames, ...dynamicNames]) {
    assert.ok(declared.has(name), `Icon ${name} is missing from the shared registry`);
  }
});

test("registry icons share one geometry and stroke contract", () => {
  for (const name of iconNames) {
    const markup = icon(name);
    assert.match(markup, /class="ui-icon"/);
    assert.match(markup, /viewBox="0 0 24 24"/);
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, /focusable="false"/);
  }
  assert.match(styles, /\.ui-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*stroke-width:\s*1\.8/s);
});

test("primary sidebar actions share the same icon column and inactive text tone", () => {
  assert.match(styles, /\.new-session,\s*\.skills-nav-button\s*\{[^}]*grid-template-columns:\s*20px minmax\(0,\s*1fr\) auto/s);
  assert.match(styles, /\.new-session,\s*\.skills-nav-button\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(indexHtml, /id="new-session"[^>]*>[\s\S]*?class="nav-leading-icon" data-icon="plus"/);
  assert.match(indexHtml, /id="open-skills"[^>]*>[\s\S]*?class="nav-leading-icon" data-icon="skills"/);
});

test("model settings selects use one explicit inset chevron contract", () => {
  const controls = [...indexHtml.matchAll(/class="settings-select-control"/g)];
  assert.equal(controls.length, 3);
  assert.match(indexHtml, /id="model-provider"[\s\S]*?class="settings-select-icon" data-icon="chevron-down"/);
  assert.match(indexHtml, /id="model-base-url"[\s\S]*?class="settings-select-icon" data-icon="chevron-down"/);
  assert.match(indexHtml, /id="model-name"[\s\S]*?class="settings-select-icon" data-icon="chevron-down"/);
  assert.match(styles, /\.settings-body \.settings-select-control select\s*\{[^}]*appearance:\s*none[^}]*padding-right:\s*44px/s);
  assert.match(styles, /\.settings-select-icon\s*\{[^}]*right:\s*14px[^}]*pointer-events:\s*none/s);
});

test("permission modes use semantically distinct icons with identical geometry", () => {
  assert.match(indexHtml, /data-permission-mode="ask"[\s\S]*?data-icon="circle-help"/);
  assert.match(indexHtml, /data-permission-mode="auto"[\s\S]*?data-icon="shield-alert"/);
  assert.match(indexHtml, /data-permission-mode="full"[\s\S]*?data-icon="shield-check"/);
  assert.match(appSource, /ask:\s*icon\("circle-help"\)/);
  assert.match(appSource, /auto:\s*icon\("shield-alert"\)/);
  assert.doesNotMatch(`${indexHtml}\n${appSource}`, /data-icon="hand"|icon\("hand"\)|shield-plus/);
  assert.match(styles, /\.permission-option-icon\s*\{[^}]*width:\s*22px[^}]*height:\s*22px/s);
  assert.match(styles, /\.permission-option-icon \.ui-icon\s*\{[^}]*width:\s*18px[^}]*height:\s*18px[^}]*stroke-width:\s*1\.75/s);
});
