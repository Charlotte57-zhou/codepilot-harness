import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { BrowserRuntime } from "../src/browser-runtime.mjs";

class FakePage extends EventEmitter {
  constructor() {
    super();
    this.currentUrl = "about:blank";
  }
  async goto(url) { this.currentUrl = url; return { status: () => 200 }; }
  async title() { return "Fixture"; }
  url() { return this.currentUrl; }
  isClosed() { return false; }
  viewportSize() { return { width: 800, height: 600 }; }
  locator() {
    return {
      ariaSnapshot: async () => "- button \"Start\"",
      innerText: async () => "Start"
    };
  }
  async screenshot() { return Buffer.from("image"); }
}

function fixture() {
  const page = new FakePage();
  const context = new EventEmitter();
  context.newPage = async () => page;
  context.pages = () => [page];
  const browser = { close: async () => {}, contexts: () => [context], newContext: async () => context };
  const playwright = { launch: async () => browser };
  const runtime = new BrowserRuntime({
    artifactStore: { saveImage: async () => ({ artifactId: "shot", width: 800, height: 600 }) },
    playwright,
    executableCandidates: [process.execPath],
    createId: (() => {
      const ids = ["session", "page"];
      return () => ids.shift();
    })()
  });
  return { runtime, page };
}

test("browser inspection projects page and console errors as bounded health diagnostics", async () => {
  const { runtime, page } = fixture();
  const started = await runtime.startManaged({ headless: true });
  await runtime.navigate({ sessionId: started.sessionId, pageId: started.pages[0].pageId, url: "https://example.test/" });
  page.emit("pageerror", new Error("render exploded"));
  page.emit("console", { type: () => "error", text: () => "uncaught fixture" });

  const inspected = await runtime.inspect({ sessionId: started.sessionId, pageId: started.pages[0].pageId });
  assert.equal(inspected.healthy, false);
  assert.deepEqual(inspected.diagnostics.pageErrors, ["render exploded"]);
  assert.deepEqual(inspected.diagnostics.consoleErrors, ["uncaught fixture"]);
  assert.deepEqual(inspected.diagnostics.httpErrors, []);
});

test("navigation resets stale diagnostics and screenshot carries the current health receipt", async () => {
  const { runtime, page } = fixture();
  const started = await runtime.startManaged({ headless: true });
  const pageId = started.pages[0].pageId;
  page.emit("pageerror", new Error("old page"));
  await runtime.navigate({ sessionId: started.sessionId, pageId, url: "https://example.test/next" });

  const screenshot = await runtime.screenshot({ sessionId: started.sessionId, pageId });
  assert.equal(screenshot.healthy, true);
  assert.deepEqual(screenshot.diagnostics.pageErrors, []);
});

test("browser health distinguishes missing product resources from favicon noise", async () => {
  const { runtime, page } = fixture();
  const started = await runtime.startManaged({ headless: true });
  const pageId = started.pages[0].pageId;
  await runtime.navigate({ sessionId: started.sessionId, pageId, url: "https://example.test/" });
  const response = (url) => ({ status: () => 404, url: () => url, request: () => ({ resourceType: () => "script" }) });
  page.emit("response", response("https://example.test/favicon.ico"));
  page.emit("response", response("https://example.test/app.js"));

  const inspected = await runtime.inspect({ sessionId: started.sessionId, pageId });
  assert.equal(inspected.healthy, false);
  assert.deepEqual(inspected.diagnostics.httpErrors, ["404 script https://example.test/app.js"]);
});
