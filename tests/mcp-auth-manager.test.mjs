import test from "node:test";
import assert from "node:assert/strict";

import {
  McpAuthenticationManager,
  McpNeedsAuthError,
  MemoryMcpCredentialStore
} from "../src/mcp-auth-manager.mjs";

test("bearer credentials stay in the secret owner while project config receives only an opaque key", async () => {
  const store = new MemoryMcpCredentialStore();
  const installs = [];
  const removals = [];
  const manager = new McpAuthenticationManager({
    workspaceRoot: "C:\\fixture",
    credentialStore: store,
    installAuthenticatedMcp: async (...args) => installs.push(args),
    removeMcp: async (...args) => removals.push(args)
  });

  assert.equal((await manager.getPublicState("github")).status, "needs-auth");
  assert.equal((await manager.storeBearerToken("github", "github_pat_fixture")).status, "authorized");
  assert.equal(installs.length, 1);
  const [, product, key] = installs[0];
  assert.equal(product.id, "github");
  assert.match(key, /^mcp:/);
  assert.equal(await manager.getAccessToken({ name: "github", productId: "github", auth: { type: "bearer", credentialKey: key } }), "github_pat_fixture");
  assert.doesNotMatch(JSON.stringify(await manager.getPublicStates()), /github_pat_fixture/);

  await manager.disconnect("github");
  assert.equal((await manager.getPublicState("github")).status, "needs-auth");
  assert.equal(removals.length, 1);
});

test("OAuth callback validates state, persists tokens and installs only after exchange", async () => {
  const store = new MemoryMcpCredentialStore();
  const installs = [];
  const oauthAuth = async (provider, options) => {
    if (!options.authorizationCode) {
      await provider.saveClientInformation({ client_id: "fixture-client" });
      await provider.saveCodeVerifier("fixture-verifier");
      await provider.redirectToAuthorization(new URL(`https://auth.example/authorize?state=${await provider.state()}`));
      return "REDIRECT";
    }
    assert.equal(options.authorizationCode, "fixture-code");
    assert.equal(await provider.codeVerifier(), "fixture-verifier");
    await provider.saveTokens({ access_token: "oauth-secret", token_type: "bearer", refresh_token: "refresh-secret", expires_in: 3600 });
    return "AUTHORIZED";
  };
  const manager = new McpAuthenticationManager({
    workspaceRoot: "C:\\fixture",
    credentialStore: store,
    oauthAuth,
    installAuthenticatedMcp: async (...args) => installs.push(args),
    removeMcp: async () => {}
  });

  const flow = await manager.beginOAuth("notion");
  assert.equal(flow.status, "pending");
  assert.equal(installs.length, 0);
  const authorizationUrl = new URL(flow.authorizationUrl);
  const callbackState = authorizationUrl.searchParams.get("state");
  const activeFlow = manager.flows.get("notion");
  const callbackUrl = new URL(activeFlow.provider.redirectUrl);
  callbackUrl.searchParams.set("code", "fixture-code");
  callbackUrl.searchParams.set("state", callbackState);
  const response = await fetch(callbackUrl);

  assert.equal(response.status, 200);
  assert.equal(installs.length, 1);
  assert.equal((await manager.getPublicState("notion")).status, "authorized");
  assert.doesNotMatch(JSON.stringify(await manager.getPublicState("notion")), /oauth-secret|refresh-secret/);
  await manager.close();
});

test("runtime authentication rejection becomes an explicit needs-auth state and clears stale credentials", async () => {
  const store = new MemoryMcpCredentialStore();
  const manager = new McpAuthenticationManager({
    workspaceRoot: "C:\\fixture",
    credentialStore: store,
    installAuthenticatedMcp: async () => {},
    removeMcp: async () => {}
  });
  await manager.storeBearerToken("github", "github_pat_fixture");
  const [, entry] = Object.entries(await store.all())[0];
  const key = manager.keyFor({ serverName: entry.serverName, serverUrl: entry.serverUrl });
  const descriptor = { name: "github", productId: "github", auth: { type: "bearer", credentialKey: key } };

  await manager.markNeedsAuth(descriptor);
  assert.equal((await manager.getPublicState("github")).status, "needs-auth");
  await assert.rejects(() => manager.getAccessToken(descriptor), McpNeedsAuthError);
});
