import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const channels = hex.match(/[a-f\d]{2}/gi).map((value) => Number.parseInt(value, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  };
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (bright + 0.05) / (dark + 0.05);
}

test("CodePilot workbench records durable product and visual contracts", async () => {
  const [product, design] = await Promise.all([read("../PRODUCT.md"), read("../DESIGN.md")]);
  assert.match(product, /\*\*Project\*\*.*仓库/);
  assert.match(product, /\*\*Task\*\*.*目标/);
  assert.match(product, /\*\*Run\*\*.*执行/);
  assert.match(design, /高密度、克制的桌面工作台/);
  assert.match(design, /reduced-motion/);
});

test("workbench shell exposes a keyboard-addressable responsive sidebar", async () => {
  const [html, app] = await Promise.all([read("../public/index.html"), read("../public/app.js")]);
  assert.match(html, /id="workspace-sidebar"/);
  assert.match(html, /id="sidebar-toggle"[^>]*aria-controls="workspace-sidebar"/);
  assert.match(html, /id="sidebar-scrim"[^>]*aria-label="关闭项目与任务导航"/);
  assert.match(app, /sidebarMedia = window\.matchMedia\("\(max-width: 1023px\)"\)/);
  assert.match(app, /function renderSidebarDrawer\(\)/);
  assert.match(app, /else if \(state\.sidebarOpen\) setSidebarOpen\(false\)/);
});

test("workbench component layer defines content-first geometry, motion and responsive modes", async () => {
  const css = await read("../public/styles.css");
  assert.match(css, /Gemini workbench redesign - durable component layer/);
  assert.match(css, /--canvas:\s*#ffffff/i);
  assert.match(css, /--radius-composer:\s*28px/);
  assert.match(css, /--conversation-content-max:\s*920px/);
  assert.match(css, /\.message\.agent\s*\{[^}]*background:\s*transparent/);
  assert.match(css, /\.composer\s*\{[^}]*border-radius:\s*var\(--radius-composer\)/);
  assert.match(css, /@media \(max-width: 1023px\)[^]*data-sidebar-open="true"/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^]*gemini-breathe/);
});

test("composer focus feedback preserves the viewport coordinate system for fixed menus", async () => {
  const [css, app] = await Promise.all([read("../public/styles.css"), read("../public/app.js")]);
  const focusRule = css.match(/\.composer:focus-within\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.doesNotMatch(focusRule, /\btransform\s*:/);
  assert.match(css, /\.composer-popover\s*\{[^}]*position:\s*fixed/);
  assert.match(app, /function positionComposerPopover\(popover, trigger, align = "left"\)/);
  assert.match(app, /window\.innerWidth - popoverRect\.width/);
  assert.match(app, /window\.innerHeight - popoverRect\.height/);
});

test("MCP token dialog keeps its title, credential field and actions in a three-part panel", async () => {
  const [html, css, app] = await Promise.all([read("../public/index.html"), read("../public/styles.css"), read("../public/app.js")]);
  assert.match(html, /id="mcp-token-form" class="confirmation-panel"[^]*class="confirmation-head"[^]*class="confirmation-body"[^]*class="confirmation-actions"/);
  assert.match(css, /#mcp-token-form\s*\{[^}]*display:\s*grid[^}]*grid-template-rows:/);
  assert.match(css, /\.confirmation-head\s*\{[^}]*grid-template-columns:\s*56px minmax\(0, 1fr\) 40px/);
  assert.match(css, /\.confirmation-body\s*\{[^}]*display:\s*grid[^}]*padding:/);
  assert.match(app, /elements\.mcpTokenCancel\.addEventListener\("click", closeMcpTokenDialog\)/);
  assert.match(app, /elements\.mcpTokenDialog\.addEventListener\("cancel"/);
});

test("white workbench text tokens retain AA contrast and visual capture covers critical surfaces", async () => {
  const capture = await read("../scripts/capture-desktop-visuals.mjs");
  assert.ok(contrastRatio("1f1f1f", "ffffff") >= 4.5);
  assert.ok(contrastRatio("444746", "f0f4f9") >= 4.5);
  assert.ok(contrastRatio("747775", "ffffff") >= 4.5);
  assert.match(capture, /1920x1080/);
  assert.match(capture, /1366x768/);
  assert.match(capture, /narrow-900x720/);
  assert.match(capture, /project-create\.png/);
  assert.match(capture, /settings\.png/);
  assert.match(capture, /skills\.png/);
  assert.match(capture, /mcp\.png/);
});
