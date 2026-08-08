import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BrowserRuntime } from "../src/browser-runtime.mjs";
import { BrowserSessionStore } from "../src/browser-session-store.mjs";

class Page extends EventEmitter {
  url() { return "https://example.test/"; }
  isClosed() { return false; }
}

test("attached browser descriptors reconnect with the same opaque session id after restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-browser-recovery-"));
  const store = new BrowserSessionStore({ workspaceRoot: root });
  await store.upsert({ sessionId: "persisted-session", mode: "attached", endpoint: "http://127.0.0.1:9222", recoverable: true });
  const context = new EventEmitter();
  context.pages = () => [new Page()];
  const browser = { contexts: () => [context], close: async () => { browser.closed = true; } };
  const runtime = new BrowserRuntime({
    artifactStore: {}, sessionStore: store,
    playwright: { connectOverCDP: async () => browser },
    createId: () => "page-id"
  });
  const recovery = await runtime.recoverPersistedSessions();
  assert.equal(recovery.recovered[0].sessionId, "persisted-session");
  assert.equal(runtime.listSessions()[0].sessionId, "persisted-session");
  await runtime.close({ preserveRecovery: true });
  assert.notEqual(browser.closed, true);
  assert.equal((await store.list())[0].sessionId, "persisted-session");
});
