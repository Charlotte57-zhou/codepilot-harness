import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { getFeaturedMcpProducts } from "../src/mcp-curation.mjs";

test("featured MCP products are curated separately from Registry runtime state", async () => {
  const products = getFeaturedMcpProducts();
  assert.deepEqual(products.map(({ id }) => id), [
    "github",
    "figma",
    "linear",
    "notion"
  ]);
  assert.equal(new Set(products.map(({ id }) => id)).size, products.length);
  assert.ok(products.every((product) =>
    product.title &&
    product.description &&
    product.publisher &&
    product.provenance === "official" &&
    product.availability === "connectable" &&
    ["oauth", "token"].includes(product.authMode) &&
    product.serverUrl
  ));
});

test("MCP catalogs do not render unavailable states as disabled actions", async () => {
  const app = await readFile(join(process.cwd(), "public", "app.js"), "utf8");
  assert.doesNotMatch(app, /mcp-featured-action[^>]*disabled/);
  assert.doesNotMatch(app, /mcp-install-button[^>]*disabled/);
  assert.match(app, /mcp-install-status/);
  assert.match(app, /mcp-featured-status is-pending/);
});

test("MCP page distinguishes curated products from the raw Registry catalog", async () => {
  const html = await readFile(join(process.cwd(), "public", "index.html"), "utf8");
  assert.match(html, /id="mcp-featured-catalog"/);
  assert.match(html, />精选连接</);
  assert.match(html, />Registry 全部</);
});
