import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadMcpCatalog } from "./mcp-catalog.mjs";

export const officialMcpRegistryUrl = "https://registry.modelcontextprotocol.io";

const catalogLocks = new Map();

function withCatalogLock(workspaceRoot, operation) {
  const previous = catalogLocks.get(workspaceRoot) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  catalogLocks.set(workspaceRoot, next);
  return next.finally(() => {
    if (catalogLocks.get(workspaceRoot) === next) catalogLocks.delete(workspaceRoot);
  });
}

function registryMetadata(record) {
  return record?._meta?.["io.modelcontextprotocol.registry/official"] ?? {};
}

function requiredInputs(items = []) {
  return items.filter((item) => item?.isRequired !== false && item?.default === undefined);
}

export function normalizeRegistryServer(record) {
  const server = record?.server ?? record;
  if (!server?.name || !server?.version) return null;
  const official = registryMetadata(record);
  const remote = (server.remotes ?? []).find((candidate) =>
    ["streamable-http", "http"].includes(candidate?.type) && candidate?.url
  );
  const npmPackage = (server.packages ?? []).find((candidate) =>
    candidate?.registryType === "npm" && candidate?.identifier && candidate?.transport?.type === "stdio"
  );
  const remoteInputs = requiredInputs(remote?.headers);
  const packageInputs = requiredInputs([
    ...(npmPackage?.environmentVariables ?? []),
    ...(npmPackage?.packageArguments ?? []),
    ...(npmPackage?.runtimeArguments ?? [])
  ]);
  const installKind = remote ? "remote" : npmPackage ? "npm" : null;
  const missingInputCount = remote ? remoteInputs.length : packageInputs.length;
  return {
    name: server.name,
    title: server.title || server.name.split("/").at(-1),
    description: server.description || "公共 MCP 服务",
    version: server.version,
    websiteUrl: server.websiteUrl ?? server.repository?.url ?? null,
    repositoryUrl: server.repository?.url ?? null,
    installKind,
    transport: remote ? "streamable-http" : npmPackage ? "stdio" : "unsupported",
    installable: Boolean(installKind) && missingInputCount === 0,
    requiresConfiguration: missingInputCount > 0,
    requiredInputCount: missingInputCount,
    registryStatus: official.status ?? "active",
    publishedAt: official.publishedAt ?? null,
    isLatest: official.isLatest !== false,
    installPlan: remote
      ? { type: "http", url: remote.url }
      : npmPackage
        ? {
            type: "stdio",
            package: npmPackage.identifier,
            packageVersion: npmPackage.version || server.version
          }
        : null
  };
}

function latestByName(records) {
  const normalized = records.map(normalizeRegistryServer).filter(Boolean);
  const latest = new Map();
  for (const server of normalized) {
    const existing = latest.get(server.name);
    if (!existing || server.isLatest || (!existing.isLatest && server.version > existing.version)) {
      latest.set(server.name, server);
    }
  }
  return [...latest.values()];
}

export async function searchOfficialMcpRegistry({
  query = "",
  limit = 24,
  cursor,
  fetchImpl = fetch,
  timeoutMs = 30_000
} = {}) {
  const url = new URL("/v0.1/servers", officialMcpRegistryUrl);
  url.searchParams.set("limit", String(Math.max(1, Math.min(50, Number(limit) || 24))));
  if (String(query).trim()) url.searchParams.set("search", String(query).trim());
  if (cursor) url.searchParams.set("cursor", cursor);
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": "CodePilot/0.1 MCP Marketplace" },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Official MCP Registry returned ${response.status}`);
  const payload = await response.json();
  return {
    source: "official",
    sourceUrl: officialMcpRegistryUrl,
    preview: true,
    servers: latestByName(Array.isArray(payload?.servers) ? payload.servers : []),
    nextCursor: payload?.metadata?.nextCursor ?? null
  };
}

export async function resolveOfficialMcpServer(name, version, options = {}) {
  const result = await searchOfficialMcpRegistry({ ...options, query: name, limit: 50 });
  const server = result.servers.find((candidate) =>
    candidate.name === name && (!version || candidate.version === version)
  );
  if (!server) {
    const error = new Error(`MCP server not found in the official registry: ${name}`);
    error.statusCode = 404;
    throw error;
  }
  return server;
}

async function writeCatalog(workspaceRoot, servers) {
  const path = join(workspaceRoot, ".codepilot", "mcp.json");
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify({ version: 1, servers }, null, 2)}\n`, "utf8");
  await rename(temporary, path);
}

function descriptorFromRegistry(server) {
  const shared = {
    name: server.name,
    enabled: true,
    title: server.title,
    description: server.description,
    registry: {
      source: "official",
      version: server.version,
      websiteUrl: server.websiteUrl,
      installedAt: new Date().toISOString()
    }
  };
  if (server.installPlan?.type === "http") {
    return { ...shared, type: "http", url: server.installPlan.url };
  }
  if (server.installPlan?.type === "stdio") {
    const executable = process.platform === "win32" ? "npx.cmd" : "npx";
    const specifier = server.installPlan.packageVersion
      ? `${server.installPlan.package}@${server.installPlan.packageVersion}`
      : server.installPlan.package;
    return { ...shared, type: "stdio", command: executable, args: ["-y", specifier] };
  }
  throw new Error("This MCP server has no CodePilot-compatible installation");
}

export async function installRegistryMcp(workspaceRoot, server) {
  if (!server?.installable || !server.installPlan) throw new Error("MCP server requires configuration before installation");
  return withCatalogLock(workspaceRoot, async () => {
    const catalog = await loadMcpCatalog(workspaceRoot);
    if (catalog.servers.some((candidate) => candidate.name === server.name)) {
      const error = new Error(`MCP server already installed: ${server.name}`);
      error.statusCode = 409;
      throw error;
    }
    const descriptor = descriptorFromRegistry(server);
    await writeCatalog(workspaceRoot, [...catalog.servers, descriptor]);
    return descriptor;
  });
}

export async function upsertAuthenticatedMcp(workspaceRoot, product, credentialKey) {
  if (!product?.serverName || !product?.serverUrl || !["oauth", "token"].includes(product.authMode)) {
    throw new Error("Authenticated MCP product is incomplete");
  }
  return withCatalogLock(workspaceRoot, async () => {
    const catalog = await loadMcpCatalog(workspaceRoot);
    const descriptor = {
      name: product.serverName,
      title: product.title,
      description: product.description,
      enabled: true,
      type: "http",
      url: product.serverUrl,
      productId: product.id,
      auth: { type: product.authMode === "token" ? "bearer" : "oauth", credentialKey },
      registry: {
        source: product.registryName ? "official" : "curated",
        version: null,
        websiteUrl: null,
        installedAt: new Date().toISOString()
      }
    };
    const existingIndex = catalog.servers.findIndex((server) => server.name === descriptor.name);
    const servers = [...catalog.servers];
    if (existingIndex >= 0) servers[existingIndex] = { ...servers[existingIndex], ...descriptor };
    else servers.push(descriptor);
    await writeCatalog(workspaceRoot, servers);
    return descriptor;
  });
}

export async function setMcpEnabled(workspaceRoot, name, enabled) {
  return withCatalogLock(workspaceRoot, async () => {
    const catalog = await loadMcpCatalog(workspaceRoot);
    let found = false;
    const servers = catalog.servers.map((server) => {
      if (server.name !== name) return server;
      found = true;
      return { ...server, enabled: Boolean(enabled) };
    });
    if (!found) {
      const error = new Error(`Unknown MCP server: ${name}`);
      error.statusCode = 404;
      throw error;
    }
    await writeCatalog(workspaceRoot, servers);
  });
}

export async function uninstallMcp(workspaceRoot, name) {
  return withCatalogLock(workspaceRoot, async () => {
    const catalog = await loadMcpCatalog(workspaceRoot);
    const servers = catalog.servers.filter((server) => server.name !== name);
    if (servers.length === catalog.servers.length) {
      const error = new Error(`Unknown MCP server: ${name}`);
      error.statusCode = 404;
      throw error;
    }
    await writeCatalog(workspaceRoot, servers);
  });
}

export async function readRawMcpConfig(workspaceRoot) {
  try {
    return JSON.parse(await readFile(join(workspaceRoot, ".codepilot", "mcp.json"), "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return { version: 1, servers: [] };
    throw error;
  }
}
