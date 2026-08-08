import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  installRegistryMcp,
  normalizeRegistryServer,
  readRawMcpConfig,
  searchOfficialMcpRegistry,
  setMcpEnabled,
  uninstallMcp
} from "../src/mcp-marketplace.mjs";

function registryRecord(overrides = {}) {
  return {
    server: {
      name: "io.example/docs",
      title: "Example Docs",
      description: "Search example documentation",
      version: "1.2.3",
      remotes: [{ type: "streamable-http", url: "https://mcp.example.test/server" }],
      ...overrides
    },
    _meta: {
      "io.modelcontextprotocol.registry/official": {
        status: "active",
        isLatest: true,
        publishedAt: "2026-07-20T00:00:00.000Z"
      }
    }
  };
}

test("registry normalization selects supported transports and exposes required configuration", () => {
  const remote = normalizeRegistryServer(registryRecord());
  assert.equal(remote.installKind, "remote");
  assert.equal(remote.installable, true);
  assert.deepEqual(remote.installPlan, { type: "http", url: "https://mcp.example.test/server" });

  const configured = normalizeRegistryServer(registryRecord({
    remotes: [{ type: "streamable-http", url: "https://secure.example.test", headers: [{ name: "Authorization", isRequired: true }] }]
  }));
  assert.equal(configured.installable, false);
  assert.equal(configured.requiresConfiguration, true);

  const npm = normalizeRegistryServer(registryRecord({
    remotes: [],
    packages: [{ registryType: "npm", identifier: "@example/mcp", version: "4.5.6", transport: { type: "stdio" } }]
  }));
  assert.equal(npm.installKind, "npm");
  assert.deepEqual(npm.installPlan, { type: "stdio", package: "@example/mcp", packageVersion: "4.5.6" });
});

test("official registry search forwards bounded query and returns normalized latest records", async () => {
  let requested;
  const result = await searchOfficialMcpRegistry({
    query: "docs",
    limit: 500,
    fetchImpl: async (url) => {
      requested = new URL(url);
      return new Response(JSON.stringify({ servers: [registryRecord()], metadata: { nextCursor: "next" } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  assert.equal(requested.pathname, "/v0.1/servers");
  assert.equal(requested.searchParams.get("search"), "docs");
  assert.equal(requested.searchParams.get("limit"), "50");
  assert.equal(result.servers[0].name, "io.example/docs");
  assert.equal(result.nextCursor, "next");
});

test("install, enable and uninstall serialize changes through the project MCP source of truth", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-mcp-marketplace-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const server = normalizeRegistryServer(registryRecord());

  await installRegistryMcp(root, server);
  let config = await readRawMcpConfig(root);
  assert.equal(config.version, 1);
  assert.deepEqual(config.servers.map(({ name, type, enabled }) => ({ name, type, enabled })), [
    { name: "io.example/docs", type: "http", enabled: true }
  ]);
  assert.equal(config.servers[0].url, "https://mcp.example.test/server");

  await setMcpEnabled(root, server.name, false);
  config = await readRawMcpConfig(root);
  assert.equal(config.servers[0].enabled, false);

  await assert.rejects(() => installRegistryMcp(root, server), /already installed/);
  await uninstallMcp(root, server.name);
  assert.deepEqual((await readRawMcpConfig(root)).servers, []);
});
