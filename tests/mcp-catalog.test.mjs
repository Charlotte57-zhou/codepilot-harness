import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  loadEnabledMcpDescriptors,
  loadMcpCatalog,
  projectMcpCatalog
} from "../src/mcp-catalog.mjs";

test("MCP catalog owns configuration and preserves disabled servers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-mcp-catalog-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".codepilot"), { recursive: true });
  await writeFile(join(root, ".codepilot", "mcp.json"), JSON.stringify({
    servers: [
      { name: "docs", command: "node", args: ["server.mjs"], env: { DOCS_TOKEN: "secret" } },
      { name: "legacy", command: "legacy.exe", enabled: false }
    ]
  }), "utf8");

  const catalog = await loadMcpCatalog(root);
  assert.deepEqual(catalog.servers.map(({ name, enabled }) => ({ name, enabled })), [
    { name: "docs", enabled: true },
    { name: "legacy", enabled: false }
  ]);
  assert.deepEqual((await loadEnabledMcpDescriptors(root)).map(({ name }) => name), ["docs"]);
});

test("public MCP projection redacts values and derives latest snapshot state", () => {
  const catalog = {
    path: "ignored",
    diagnostics: [],
    servers: [{
      name: "docs",
      enabled: true,
      command: "C:\\tools\\docs-server.exe",
      args: ["--token", "secret-value"],
      env: { DOCS_TOKEN: "secret-value" }
    }]
  };
  const events = [
    { type: "mcp_tools_refreshed", timestamp: "2026-07-20T10:00:00.000Z", data: { server: "docs", toolCount: 2 } },
    { type: "capability_snapshot_created", timestamp: "2026-07-20T10:00:01.000Z", data: { snapshotId: "snap-1", turn: 3, mcpServers: [{ name: "docs", toolCount: 2 }] } }
  ];
  const projection = projectMcpCatalog(catalog, events);
  assert.equal(projection.servers[0].status, "available");
  assert.equal(projection.servers[0].toolCount, 2);
  assert.equal(projection.servers[0].argumentCount, 2);
  assert.equal(projection.servers[0].environmentKeyCount, 1);
  assert.equal(JSON.stringify(projection).includes("secret-value"), false);
});

test("latest MCP failure remains visible instead of disappearing from the catalog", () => {
  const catalog = {
    diagnostics: [],
    servers: [{ name: "broken", enabled: true, command: "broken" }]
  };
  const projection = projectMcpCatalog(catalog, [
    { type: "mcp_connection_failed", timestamp: "2026-07-20T10:00:00.000Z", data: { server: "broken", message: "TOKEN leaked here" } },
    { type: "capability_snapshot_created", timestamp: "2026-07-20T10:00:01.000Z", data: { snapshotId: "snap-2", turn: 1, mcpServers: [] } }
  ]);
  assert.equal(projection.servers[0].status, "failed");
  assert.equal(JSON.stringify(projection).includes("TOKEN leaked here"), false);
});

test("authentication loss is projected as needs-auth without exposing the credential key", () => {
  const projection = projectMcpCatalog({
    diagnostics: [],
    servers: [{
      name: "github",
      productId: "github",
      enabled: true,
      type: "http",
      url: "https://mcp.example.test",
      auth: { type: "bearer", credentialKey: "mcp:private-key" }
    }]
  }, [{ type: "mcp_auth_required", timestamp: "2026-07-20T10:00:00.000Z", data: { server: "github" } }]);
  assert.equal(projection.servers[0].status, "needs-auth");
  assert.equal(projection.servers[0].authMode, "bearer");
  assert.equal(JSON.stringify(projection).includes("mcp:private-key"), false);
});

test("configuration changes project as next-turn transitions without rewriting an active snapshot", () => {
  const snapshot = {
    type: "capability_snapshot_created",
    data: { snapshotId: "snap-3", turn: 2, mcpServers: [{ name: "old", toolCount: 1 }] }
  };
  const projection = projectMcpCatalog({
    diagnostics: [],
    servers: [
      { name: "old", enabled: false, command: "old" },
      { name: "new", enabled: true, command: "new" }
    ]
  }, [snapshot]);
  assert.equal(projection.servers[0].status, "pending-disable");
  assert.equal(projection.servers[0].activeInCurrentSnapshot, true);
  assert.equal(projection.servers[1].status, "pending-enable");
  assert.equal(projection.servers[1].activeInCurrentSnapshot, false);
});
