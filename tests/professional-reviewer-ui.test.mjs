import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("reviewer projects one run change set into stacked file sections and unified diff controls", async () => {
  const app = await read("../public/app.js");
  assert.match(app, /fileReviewMeta/);
  assert.match(app, /reviewContextMode: "compact"/);
  assert.match(app, /class="review-toolbar"/);
  assert.match(app, /data-review-context="compact"/);
  assert.match(app, /data-review-action="expand-all"/);
  assert.match(app, /role="table"/);
  assert.doesNotMatch(app, /review-file-nav|data-review-file-target/);
  assert.doesNotMatch(app, />旧<|>新</);
  assert.doesNotMatch(app, /review-file-command|git diff/);
});

test("reviewer uses non-color status, one line gutter and responsive stacked files", async () => {
  const css = await read("../public/styles.css");
  assert.match(css, /\.review-status\.is-modified/);
  assert.match(css, /grid-template-columns:\s*24px 52px minmax\(max-content, 1fr\)/);
  assert.match(css, /\.diff-row code\s*\{[^}]*white-space:\s*pre/);
  assert.match(css, /\.diff-omitted\s*\{[^}]*border-top:/);
  assert.doesNotMatch(css, /\.review-file-nav/);
  assert.match(css, /@media \(max-width: 720px\)[^]*\.review-file-list\s*\{[^}]*padding:/);
  assert.match(css, /prefers-reduced-motion: reduce[^]*\.review-file-chevron/);
});

test("sidebar exposes a generic local identity and separates workspace settings from runtime config", async () => {
  const [html, app, css] = await Promise.all([
    read("../public/index.html"),
    read("../public/app.js"),
    read("../public/styles.css")
  ]);
  assert.match(html, /class="sidebar-bottom" aria-label="本地用户与设置"/);
  assert.match(html, /<strong>本地用户<\/strong>/);
  assert.match(html, /id="sidebar-settings"[^>]*aria-haspopup="dialog"/);
  assert.match(app, /#sidebar-settings[^\n]+openWorkspaceSettings/);
  assert.match(app, /#model-settings[^\n]+openModelSettings/);
  assert.match(html, /id="settings-layer"[\s\S]*data-settings-panel="appearance"/);
  assert.match(html, /id="runtime-settings-layer"[\s\S]*id="model-form"/);
  assert.match(css, /\.sidebar-avatar\s*\{/);
  assert.match(css, /\.sidebar-settings-button\s*\{/);
});

test("real Electron regression captures the review workspace when a run has file changes", async () => {
  const capture = await read("../scripts/capture-desktop-visuals.mjs");
  assert.match(capture, /\.trellis", "artifacts", "ui-regression/);
  assert.match(capture, /data-change-action="review"/);
  assert.match(capture, /review\.png/);
  assert.match(capture, /review-full\.png/);
  assert.match(capture, /`\$\{size\.name\}-review\.png`/);
});
