import test from "node:test";
import assert from "node:assert/strict";

import { createAutomationTools } from "../src/tools/automation-tools.mjs";

function fixtureManager() {
  const browser = {
    inspect: async () => ({ sessionId: "browser", pageId: "page", title: "Fixture", url: "https://example.test", externalContent: "- button \"Apply\"" }),
    navigate: async () => ({}), click: async () => ({}), type: async () => ({}), wait: async () => ({}),
    screenshot: async () => ({}), newPage: async () => ({}), listSessions: () => []
  };
  const computer = {
    listWindows: async () => [{ hwnd: "42", title: "Fixture" }],
    inspect: async () => ({ sessionId: "computer", nodes: [{ name: "Apply" }] }),
    screenshot: async () => ({}), click: async () => ({}), setValue: async () => ({}),
    keypress: async () => ({}), listSessions: () => []
  };
  return {
    browser,
    computer,
    directory: new Map([["browser", { kind: "browser" }], ["computer", { kind: "computer" }]]),
    require(sessionId, kind) {
      const entry = this.directory.get(sessionId);
      if (!entry || entry.kind !== kind) throw new Error("missing session");
      return entry;
    },
    startBrowser: async () => ({ sessionId: "browser", pageId: "page", mode: "managed" }),
    startComputer: async () => ({ sessionId: "computer", window: { title: "Fixture" } }),
    closeSession: async () => ({ closed: true })
  };
}

test("automation tool contracts expose the complete browser and computer capability surface", () => {
  const tools = createAutomationTools({ interactionManager: fixtureManager() });
  assert.deepEqual(tools.map((tool) => tool.name), [
    "BrowserStart", "BrowserInspect", "BrowserNavigate", "BrowserClick", "BrowserType", "BrowserWait",
    "BrowserScreenshot", "BrowserNewPage", "ComputerListWindows", "ComputerStart", "ComputerInspect",
    "ComputerScreenshot", "ComputerClick", "ComputerSetValue", "ComputerKeypress", "InteractionClose"
  ]);
  assert.equal(tools.find((tool) => tool.name === "BrowserInspect").isReadOnly, true);
  assert.equal(tools.find((tool) => tool.name === "ComputerClick").isConcurrencySafe, false);
});

test("browser inspection is explicitly marked as untrusted external content", async () => {
  const tool = createAutomationTools({ interactionManager: fixtureManager() }).find((candidate) => candidate.name === "BrowserInspect");
  const parsed = tool.inputSchema.safeParse({ sessionId: "browser" });
  assert.equal(parsed.success, false, "session ids must be opaque UUIDs");

  const input = { sessionId: "00000000-0000-4000-8000-000000000001" };
  const manager = fixtureManager();
  manager.directory.set(input.sessionId, { kind: "browser" });
  const inspect = createAutomationTools({ interactionManager: manager }).find((candidate) => candidate.name === "BrowserInspect");
  const result = await inspect.call(input, {});
  assert.equal(result.ok, true);
  assert.match(result.content, /UNTRUSTED_BROWSER_CONTENT/);
});

test("typed text is excluded from permission matcher and audit metadata", async () => {
  const tool = createAutomationTools({ interactionManager: fixtureManager() }).find((candidate) => candidate.name === "BrowserType");
  const input = {
    sessionId: "00000000-0000-4000-8000-000000000001",
    locator: { label: "Password" },
    text: "super-secret-fixture"
  };
  const matcher = await tool.preparePermissionMatcher(input);
  const permission = await tool.checkPermissions(input);
  assert.doesNotMatch(JSON.stringify(matcher), /super-secret-fixture/);
  assert.doesNotMatch(JSON.stringify(permission), /super-secret-fixture/);
  assert.match(permission.summary, /20/);
});
