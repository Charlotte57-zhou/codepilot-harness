import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

function normalizeDescriptor(server, index) {
  if (!server || typeof server !== "object") {
    return { diagnostic: { index, code: "INVALID_SERVER", message: "MCP server entry must be an object" } };
  }
  const name = String(server.name ?? "").trim();
  if (!name) {
    return { diagnostic: { index, code: "MISSING_NAME", message: "MCP server entry requires a name" } };
  }
  return {
    descriptor: {
      ...server,
      name,
      enabled: server.enabled !== false
    }
  };
}

/**
 * `.codepilot/mcp.json` is the configuration source of truth. Runtime connection
 * state is deliberately not written back into this file.
 */
export async function loadMcpCatalog(workspaceRoot) {
  const path = join(workspaceRoot, ".codepilot", "mcp.json");
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { path, servers: [], diagnostics: [] };
    if (error instanceof SyntaxError) {
      return {
        path,
        servers: [],
        diagnostics: [{ code: "INVALID_JSON", message: "mcp.json is not valid JSON" }]
      };
    }
    throw error;
  }
  if (!Array.isArray(parsed?.servers)) {
    return {
      path,
      servers: [],
      diagnostics: [{ code: "INVALID_SERVERS", message: "mcp.json requires a servers array" }]
    };
  }
  const diagnostics = [];
  const servers = [];
  const names = new Set();
  for (const [index, value] of parsed.servers.entries()) {
    const normalized = normalizeDescriptor(value, index);
    if (normalized.diagnostic) {
      diagnostics.push(normalized.diagnostic);
      continue;
    }
    if (names.has(normalized.descriptor.name)) {
      diagnostics.push({ index, code: "DUPLICATE_NAME", message: `Duplicate MCP server name: ${normalized.descriptor.name}` });
      continue;
    }
    names.add(normalized.descriptor.name);
    servers.push(normalized.descriptor);
  }
  return { path, servers, diagnostics };
}

export async function loadEnabledMcpDescriptors(workspaceRoot) {
  const catalog = await loadMcpCatalog(workspaceRoot);
  return catalog.servers.filter((server) => server.enabled);
}

function publicDescriptor(server) {
  const transport = server.type ?? (server.command ? "stdio" : "unknown");
  let remoteHost = null;
  try { remoteHost = server.url ? new URL(server.url).host : null; } catch {}
  return {
    name: server.name,
    title: server.title ?? server.name.split("/").at(-1),
    description: server.description ?? "项目 MCP 服务",
    enabled: server.enabled,
    transport,
    command: server.command ? basename(String(server.command)) : null,
    remoteHost,
    argumentCount: Array.isArray(server.args) ? server.args.length : 0,
    environmentKeyCount: server.env && typeof server.env === "object" ? Object.keys(server.env).length : 0,
    source: server.registry?.source ?? "project",
    version: server.registry?.version ?? null,
    websiteUrl: server.registry?.websiteUrl ?? null,
    productId: server.productId ?? null,
    authMode: server.auth?.type ?? null
  };
}

/**
 * Produces a renderer-safe projection. Environment values and arguments never
 * cross the HTTP boundary; the latest session events only describe observed
 * runtime state and never replace project configuration.
 */
export function projectMcpCatalog(catalog, events = []) {
  const latestByServer = new Map();
  for (const event of events) {
    if (!["mcp_tools_refreshed", "mcp_connection_failed", "mcp_auth_required", "mcp_disconnected"].includes(event.type)) continue;
    if (event.data?.server) latestByServer.set(event.data.server, event);
  }
  const latestSnapshot = [...events].reverse().find((event) => event.type === "capability_snapshot_created");
  const activeServers = new Map((latestSnapshot?.data?.mcpServers ?? []).map((server) => [server.name, server]));
  const servers = catalog.servers.map((descriptor) => {
    const publicConfig = publicDescriptor(descriptor);
    const latest = latestByServer.get(descriptor.name);
    const active = activeServers.get(descriptor.name);
    let status = descriptor.enabled ? "configured" : active ? "pending-disable" : "disabled";
    if (descriptor.enabled && latest?.type === "mcp_auth_required") status = "needs-auth";
    else if (descriptor.enabled && latest?.type === "mcp_connection_failed") status = "failed";
    else if (descriptor.enabled && latest?.type === "mcp_disconnected") status = "disconnected";
    else if (descriptor.enabled && active) status = "available";
    else if (descriptor.enabled && latestSnapshot && !active) status = "pending-enable";
    return {
      ...publicConfig,
      status,
      toolCount: Number(active?.toolCount) || 0,
      activeInCurrentSnapshot: Boolean(active),
      lastObservedAt: latest?.timestamp ?? null
    };
  });
  return {
    configuredCount: servers.length,
    enabledCount: servers.filter((server) => server.enabled).length,
    availableCount: servers.filter((server) => server.status === "available").length,
    toolCount: servers.reduce((total, server) => total + server.toolCount, 0),
    servers,
    diagnostics: catalog.diagnostics,
    configPath: ".codepilot/mcp.json",
    snapshotId: latestSnapshot?.data?.snapshotId ?? null,
    snapshotTurn: latestSnapshot?.data?.turn ?? null
  };
}
