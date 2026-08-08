import test from "node:test";
import assert from "node:assert/strict";

import { HttpMcpClient, createMcpClientForDescriptor } from "../src/capability-manager.mjs";

test("HTTP MCP client preserves the negotiated session across JSON and SSE requests", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ url, method: options.method, headers: options.headers, body });
    if (options.method === "DELETE") return new Response(null, { status: 204 });
    if (body.method === "initialize") {
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { capabilities: {} } }), {
        status: 200,
        headers: { "content-type": "application/json", "mcp-session-id": "session-1" }
      });
    }
    if (body.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (body.method === "tools/list") {
      return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search" }] } })}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    }
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: "done" }] } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const client = new HttpMcpClient({ name: "remote", type: "http", url: "https://mcp.example.test" }, { fetchImpl });

  assert.deepEqual(await client.listTools(), [{ name: "search" }]);
  assert.deepEqual(await client.callTool("search", { query: "MCP" }), { content: [{ type: "text", text: "done" }] });
  await client.close();

  assert.equal(calls[2].headers["mcp-session-id"], "session-1");
  assert.equal(calls[3].body.method, "tools/call");
  assert.equal(calls.at(-1).method, "DELETE");
});

test("MCP client factory assigns streamable HTTP and stdio to their transport owners", () => {
  assert.ok(createMcpClientForDescriptor({ name: "remote", type: "streamable-http", url: "https://example.test" }) instanceof HttpMcpClient);
  assert.equal(createMcpClientForDescriptor({ name: "local", command: "node" }).constructor.name, "StdioMcpClient");
});

test("HTTP MCP client obtains bearer credentials at request time and turns 401 into needs-auth", async () => {
  const descriptor = { name: "github", productId: "github", type: "http", url: "https://mcp.example.test", auth: { type: "bearer", credentialKey: "mcp:key" } };
  const observed = [];
  const authManager = {
    getAccessToken: async () => "runtime-secret",
    markNeedsAuth: async (value) => observed.push(value)
  };
  const client = new HttpMcpClient(descriptor, {
    authManager,
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.authorization, "Bearer runtime-secret");
      return new Response(null, { status: 401 });
    }
  });

  await assert.rejects(() => client.listTools(), (error) => error.code === "MCP_NEEDS_AUTH");
  assert.deepEqual(observed, [descriptor]);
});
