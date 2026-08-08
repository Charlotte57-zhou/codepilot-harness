import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";

import { getFeaturedMcpProduct, getFeaturedMcpProducts } from "./mcp-curation.mjs";
import { upsertAuthenticatedMcp, uninstallMcp } from "./mcp-marketplace.mjs";
import { loadMcpCredentialVault, updateMcpCredentialVault } from "./secret-store.mjs";

const flowTimeoutMs = 5 * 60_000;

function credentialKey(workspaceRoot, product) {
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({ workspaceRoot, serverName: product.serverName, serverUrl: product.serverUrl }))
    .digest("hex")
    .slice(0, 24);
  return `mcp:${fingerprint}`;
}

function withTimeout(fetchImpl, timeoutMs = 30_000) {
  return (input, init = {}) => fetchImpl(input, {
    ...init,
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(timeoutMs)])
      : AbortSignal.timeout(timeoutMs)
  });
}

class DpapiCredentialStore {
  constructor() {
    this.vault = undefined;
    this.loadPromise = undefined;
  }

  async all() {
    if (this.vault) return this.vault;
    this.loadPromise ??= loadMcpCredentialVault().then((vault) => {
      this.vault = vault;
      return vault;
    });
    return this.loadPromise;
  }

  async get(key) {
    return structuredClone((await this.all())[key]);
  }

  async set(key, value) {
    const next = await updateMcpCredentialVault((vault) => {
      vault[key] = structuredClone(value);
      return vault;
    });
    this.vault = next;
  }

  async delete(key) {
    const next = await updateMcpCredentialVault((vault) => {
      delete vault[key];
      return vault;
    });
    this.vault = next;
  }
}

class CodePilotOAuthProvider {
  constructor({ product, redirectUrl, key, store }) {
    this.product = product;
    this.redirectUrl = redirectUrl;
    this.key = key;
    this.store = store;
    this.oauthState = randomBytes(32).toString("base64url");
    this.authorizationUrl = null;
  }

  get clientMetadata() {
    return {
      client_name: `CodePilot (${this.product.title})`,
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none"
    };
  }

  state() {
    return this.oauthState;
  }

  async clientInformation() {
    return (await this.store.get(this.key))?.clientInformation;
  }

  async saveClientInformation(clientInformation) {
    const entry = await this.store.get(this.key) ?? {};
    await this.store.set(this.key, { ...entry, clientInformation });
  }

  async tokens() {
    const tokens = (await this.store.get(this.key))?.tokens;
    if (!tokens?.access_token && !tokens?.refresh_token) return undefined;
    const { expiresAt, ...oauthTokens } = tokens;
    return oauthTokens;
  }

  async saveTokens(tokens) {
    const entry = await this.store.get(this.key) ?? {};
    const previous = entry.tokens ?? {};
    await this.store.set(this.key, {
      ...entry,
      productId: this.product.id,
      serverName: this.product.serverName,
      serverUrl: this.product.serverUrl,
      tokens: {
        ...tokens,
        refresh_token: tokens.refresh_token ?? previous.refresh_token,
        expiresAt: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : null
      }
    });
  }

  async redirectToAuthorization(url) {
    this.authorizationUrl = String(url);
  }

  async saveCodeVerifier(codeVerifier) {
    const entry = await this.store.get(this.key) ?? {};
    await this.store.set(this.key, { ...entry, codeVerifier });
  }

  async codeVerifier() {
    const verifier = (await this.store.get(this.key))?.codeVerifier;
    if (!verifier) throw new Error("OAuth PKCE verifier is missing");
    return verifier;
  }

  async saveDiscoveryState(discoveryState) {
    const entry = await this.store.get(this.key) ?? {};
    await this.store.set(this.key, { ...entry, discoveryState });
  }

  async discoveryState() {
    return (await this.store.get(this.key))?.discoveryState;
  }

  async invalidateCredentials(scope) {
    if (scope === "all") return this.store.delete(this.key);
    const entry = await this.store.get(this.key);
    if (!entry) return;
    if (scope === "tokens") delete entry.tokens;
    if (scope === "client") delete entry.clientInformation;
    if (scope === "verifier") delete entry.codeVerifier;
    if (scope === "discovery") delete entry.discoveryState;
    await this.store.set(this.key, entry);
  }
}

export class McpNeedsAuthError extends Error {
  constructor(serverName) {
    super(`MCP server requires authentication: ${serverName}`);
    this.name = "McpNeedsAuthError";
    this.code = "MCP_NEEDS_AUTH";
  }
}

export class McpAuthenticationManager {
  constructor({
    workspaceRoot,
    credentialStore = new DpapiCredentialStore(),
    fetchImpl = fetch,
    oauthAuth = auth,
    installAuthenticatedMcp = upsertAuthenticatedMcp,
    removeMcp = uninstallMcp
  } = {}) {
    if (!workspaceRoot) throw new TypeError("McpAuthenticationManager requires workspaceRoot");
    this.workspaceRoot = workspaceRoot;
    this.store = credentialStore;
    this.fetchImpl = withTimeout(fetchImpl);
    this.oauthAuth = oauthAuth;
    this.installAuthenticatedMcp = installAuthenticatedMcp;
    this.removeMcp = removeMcp;
    this.flows = new Map();
    this.failures = new Map();
    this.refreshes = new Map();
    this.needsAuth = new Set();
  }

  keyFor(product) {
    return credentialKey(this.workspaceRoot, product);
  }

  async getPublicStates() {
    const states = {};
    for (const product of getFeaturedMcpProducts()) {
      if (product.availability !== "connectable") {
        states[product.id] = { status: "unavailable", authMode: product.authMode };
        continue;
      }
      states[product.id] = await this.getPublicState(product.id);
    }
    return states;
  }

  async getPublicState(productId) {
    const product = getFeaturedMcpProduct(productId);
    if (!product?.serverUrl) return { status: "unavailable", authMode: product?.authMode ?? null };
    const flow = this.flows.get(productId);
    if (flow) return { status: "pending", authMode: product.authMode, startedAt: flow.startedAt };
    if (this.needsAuth.has(productId)) return { status: "needs-auth", authMode: product.authMode };
    const failure = this.failures.get(productId);
    const entry = await this.store.get(this.keyFor(product));
    const authorized = product.authMode === "token"
      ? Boolean(entry?.bearerToken)
      : Boolean(entry?.tokens?.access_token || entry?.tokens?.refresh_token);
    if (authorized) return { status: "authorized", authMode: product.authMode };
    if (failure) return { status: "failed", authMode: product.authMode, message: failure };
    return { status: "needs-auth", authMode: product.authMode };
  }

  async beginOAuth(productId) {
    const product = getFeaturedMcpProduct(productId);
    if (!product?.serverUrl || product.authMode !== "oauth" || product.availability !== "connectable") {
      const error = new Error("This MCP product does not support OAuth connection");
      error.statusCode = 400;
      throw error;
    }
    await this.cancelFlow(productId);
    this.failures.delete(productId);
    this.needsAuth.delete(productId);
    const flowId = randomUUID();
    let flow;
    const callbackServer = createServer((request, response) => {
      void this.#handleCallback(flow, request, response);
    });
    await new Promise((resolve, reject) => {
      callbackServer.once("error", reject);
      callbackServer.listen(0, "127.0.0.1", resolve);
    });
    const address = callbackServer.address();
    const port = typeof address === "object" && address ? address.port : null;
    if (!port) {
      callbackServer.close();
      throw new Error("OAuth callback listener did not receive a port");
    }
    const key = this.keyFor(product);
    const provider = new CodePilotOAuthProvider({
      product,
      key,
      store: this.store,
      redirectUrl: `http://127.0.0.1:${port}/oauth/callback`
    });
    flow = {
      id: flowId,
      product,
      key,
      provider,
      server: callbackServer,
      startedAt: new Date().toISOString(),
      timeout: setTimeout(() => {
        this.failures.set(productId, "授权等待超时，请重新连接");
        void this.cancelFlow(productId);
      }, flowTimeoutMs)
    };
    this.flows.set(productId, flow);
    try {
      const result = await this.oauthAuth(provider, { serverUrl: product.serverUrl, fetchFn: this.fetchImpl });
      if (result === "AUTHORIZED") {
        await this.#completeAuthorization(flow);
        return { flowId, status: "authorized", authorizationUrl: null };
      }
      if (!provider.authorizationUrl) throw new Error("OAuth provider did not return an authorization URL");
      return { flowId, status: "pending", authorizationUrl: provider.authorizationUrl };
    } catch (error) {
      this.failures.set(productId, "认证发现失败，请检查服务端兼容性后重试");
      await this.cancelFlow(productId);
      throw error;
    }
  }

  async storeBearerToken(productId, token) {
    const product = getFeaturedMcpProduct(productId);
    if (!product?.serverUrl || product.authMode !== "token" || product.availability !== "connectable") {
      const error = new Error("This MCP product does not accept a personal token");
      error.statusCode = 400;
      throw error;
    }
    const value = String(token ?? "").trim();
    if (value.length < 8 || value.length > 4096) {
      const error = new Error("Token length is invalid");
      error.statusCode = 400;
      throw error;
    }
    const key = this.keyFor(product);
    await this.store.set(key, {
      productId,
      serverName: product.serverName,
      serverUrl: product.serverUrl,
      bearerToken: value,
      storedAt: new Date().toISOString()
    });
    await this.installAuthenticatedMcp(this.workspaceRoot, product, key);
    this.failures.delete(productId);
    this.needsAuth.delete(productId);
    return this.getPublicState(productId);
  }

  async disconnect(productId) {
    const product = getFeaturedMcpProduct(productId);
    if (!product?.serverUrl) {
      const error = new Error("Unknown MCP product");
      error.statusCode = 404;
      throw error;
    }
    await this.cancelFlow(productId);
    await this.store.delete(this.keyFor(product));
    this.failures.delete(productId);
    this.needsAuth.delete(productId);
    try { await this.removeMcp(this.workspaceRoot, product.serverName); } catch (error) {
      if (error?.statusCode !== 404) throw error;
    }
    return this.getPublicState(productId);
  }

  async getAccessToken(descriptor) {
    const key = descriptor?.auth?.credentialKey;
    if (!key) return null;
    const entry = await this.store.get(key);
    if (descriptor.auth.type === "bearer") {
      if (!entry?.bearerToken) throw new McpNeedsAuthError(descriptor.name);
      return entry.bearerToken;
    }
    if (descriptor.auth.type !== "oauth") return null;
    const expiresAt = entry?.tokens?.expiresAt;
    if (entry?.tokens?.access_token && (!expiresAt || expiresAt > Date.now() + 60_000)) {
      return entry.tokens.access_token;
    }
    if (!entry?.tokens?.refresh_token) throw new McpNeedsAuthError(descriptor.name);
    let refresh = this.refreshes.get(key);
    if (!refresh) {
      refresh = this.#refreshOAuth(descriptor, key).finally(() => this.refreshes.delete(key));
      this.refreshes.set(key, refresh);
    }
    return refresh;
  }

  async markNeedsAuth(descriptor) {
    if (!descriptor?.productId) return;
    this.failures.delete(descriptor.productId);
    this.needsAuth.add(descriptor.productId);
    const key = descriptor?.auth?.credentialKey;
    if (!key) return;
    const entry = await this.store.get(key);
    if (!entry) return;
    if (descriptor.auth.type === "bearer") delete entry.bearerToken;
    if (descriptor.auth.type === "oauth") delete entry.tokens;
    await this.store.set(key, entry);
  }

  async cancelFlow(productId) {
    const flow = this.flows.get(productId);
    if (!flow) return;
    this.flows.delete(productId);
    clearTimeout(flow.timeout);
    await new Promise((resolve) => flow.server.close(() => resolve()));
  }

  async close() {
    await Promise.all([...this.flows.keys()].map((productId) => this.cancelFlow(productId)));
  }

  async #refreshOAuth(descriptor, key) {
    const product = getFeaturedMcpProduct(descriptor.productId);
    if (!product) throw new McpNeedsAuthError(descriptor.name);
    const provider = new CodePilotOAuthProvider({
      product,
      key,
      store: this.store,
      redirectUrl: "http://127.0.0.1/oauth/unused"
    });
    try {
      const result = await this.oauthAuth(provider, { serverUrl: product.serverUrl, fetchFn: this.fetchImpl });
      if (result !== "AUTHORIZED") throw new McpNeedsAuthError(descriptor.name);
      const entry = await this.store.get(key);
      if (!entry?.tokens?.access_token) throw new McpNeedsAuthError(descriptor.name);
      return entry.tokens.access_token;
    } catch {
      await provider.invalidateCredentials("tokens");
      this.needsAuth.add(product.id);
      throw new McpNeedsAuthError(descriptor.name);
    }
  }

  async #handleCallback(flow, request, response) {
    if (!flow || this.flows.get(flow.product.id)?.id !== flow.id) {
      response.writeHead(410, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>Authorization session expired</h1>");
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/oauth/callback") {
      response.writeHead(404).end();
      return;
    }
    const errorCode = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (errorCode || !code || state !== flow.provider.oauthState) {
      this.failures.set(flow.product.id, state !== flow.provider.oauthState ? "授权状态校验失败" : "用户取消或授权服务拒绝连接");
      response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>CodePilot MCP authorization failed</h1><p>Return to CodePilot and try again.</p>");
      await this.cancelFlow(flow.product.id);
      return;
    }
    try {
      await this.oauthAuth(flow.provider, {
        serverUrl: flow.product.serverUrl,
        authorizationCode: code,
        fetchFn: this.fetchImpl
      });
      await this.#completeAuthorization(flow);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>CodePilot MCP connected</h1><p>You can close this window and return to CodePilot.</p>");
    } catch {
      this.failures.set(flow.product.id, "Token 交换失败，请重新连接");
      response.writeHead(500, { "content-type": "text/html; charset=utf-8" });
      response.end("<h1>CodePilot MCP authorization failed</h1><p>Return to CodePilot and try again.</p>");
      await this.cancelFlow(flow.product.id);
    }
  }

  async #completeAuthorization(flow) {
    await this.installAuthenticatedMcp(this.workspaceRoot, flow.product, flow.key);
    this.failures.delete(flow.product.id);
    this.needsAuth.delete(flow.product.id);
    if (this.flows.get(flow.product.id)?.id === flow.id) {
      this.flows.delete(flow.product.id);
      clearTimeout(flow.timeout);
      flow.server.close();
    }
  }
}

export class MemoryMcpCredentialStore {
  constructor(initial = {}) {
    this.vault = structuredClone(initial);
  }
  async all() { return structuredClone(this.vault); }
  async get(key) { return structuredClone(this.vault[key]); }
  async set(key, value) { this.vault[key] = structuredClone(value); }
  async delete(key) { delete this.vault[key]; }
}
