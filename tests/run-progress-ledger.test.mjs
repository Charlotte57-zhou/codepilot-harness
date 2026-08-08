import test from "node:test";
import assert from "node:assert/strict";
import { RunProgressLedger } from "../src/run-progress-ledger.mjs";

const sessionId = "00000000-0000-4000-8000-000000000001";
const pageId = "00000000-0000-4000-8000-000000000002";
const previewUrl = "http://127.0.0.1:43123/preview/index.html";

function observePreview(ledger, path = "index.html") {
  ledger.observe({ name: "PreviewArtifact", input: { path } }, {
    ok: true,
    metadata: { kind: "workspace_preview", path, url: previewUrl }
  });
  ledger.observe({ name: "BrowserNavigate", input: { sessionId, pageId, url: previewUrl } }, {
    ok: true,
    metadata: { automation: { sessionId, pageId, url: previewUrl, status: 200 } }
  });
}

function observeHealthy(ledger, tool) {
  ledger.observe({ name: tool, input: { sessionId, pageId } }, {
    ok: true,
    metadata: { automation: { sessionId, pageId, url: previewUrl, healthy: true, diagnostics: { pageErrors: [], consoleErrors: [] } } }
  });
}

test("completion ledger blocks a workspace build without mutation evidence", () => {
  const ledger = new RunProgressLedger({ task: "帮我做一个飞机大战小游戏" });
  const decision = ledger.evaluateCompletion();
  assert.equal(decision.accepted, false);
  assert.match(decision.feedback, /Write\/Edit\/Delete/);
});

test("completion ledger accepts a read-only audit after inspection without inventing mutation work", () => {
  const ledger = new RunProgressLedger({ task: "只读检查代码，不要修改、创建或删除任何文件。" });
  ledger.observe({ name: "Read", input: { path: "src/a.js" } }, { ok: true, metadata: { path: "src/a.js" } });
  const decision = ledger.evaluateCompletion();
  assert.equal(decision.accepted, true);
  assert.equal(decision.snapshot.workspaceMutationExpected, false);
});

test("creating only a parent directory does not masquerade as delivered content", () => {
  const ledger = new RunProgressLedger({ task: "创建 index.html" });
  ledger.observe({ name: "CreateDirectory", input: { path: "games" } }, { ok: true, metadata: { path: "games" } });
  const decision = ledger.evaluateCompletion();
  assert.equal(decision.accepted, false);
  assert.match(decision.reasons.join("\n"), /仅创建目录/);
});

test("completion ledger accepts a successful workspace content mutation when visual tools are unavailable", () => {
  const ledger = new RunProgressLedger({ task: "创建 index.html" });
  ledger.observe({ name: "Write" }, { ok: true, metadata: { path: "index.html" } });
  assert.equal(ledger.evaluateCompletion().accepted, true);
});

test("web delivery requires an artifact-linked navigation, inspect and screenshot", () => {
  const ledger = new RunProgressLedger({ task: "创建网页", visualVerificationAvailable: true });
  ledger.observe({ name: "Write", input: { path: "index.html" } }, { ok: true, metadata: { path: "index.html" } });
  observeHealthy(ledger, "BrowserInspect");
  assert.match(ledger.evaluateCompletion().reasons.join("\n"), /PreviewArtifact/);

  observePreview(ledger);
  observeHealthy(ledger, "BrowserInspect");
  assert.equal(ledger.evaluateCompletion().accepted, false);
  observeHealthy(ledger, "BrowserScreenshot");
  assert.equal(ledger.evaluateCompletion().accepted, true);
});

test("an unrelated browser page cannot satisfy artifact verification", () => {
  const ledger = new RunProgressLedger({ task: "创建网页", visualVerificationAvailable: true });
  ledger.observe({ name: "Write" }, { ok: true, metadata: { path: "index.html" } });
  observePreview(ledger);
  const otherUrl = "https://example.test/";
  ledger.observe({ name: "BrowserNavigate", input: { sessionId, pageId, url: otherUrl } }, {
    ok: true,
    metadata: { automation: { sessionId, pageId, url: otherUrl, status: 200 } }
  });
  observeHealthy(ledger, "BrowserInspect");
  observeHealthy(ledger, "BrowserScreenshot");
  assert.equal(ledger.evaluateCompletion().accepted, false);
});

test("interactive delivery requires a key action and fresh post-action observations", () => {
  const ledger = new RunProgressLedger({ task: "创建飞机大战小游戏", visualVerificationAvailable: true });
  ledger.observe({ name: "Write" }, { ok: true, metadata: { path: "index.html" } });
  observePreview(ledger);
  observeHealthy(ledger, "BrowserInspect");
  observeHealthy(ledger, "BrowserScreenshot");
  assert.match(ledger.evaluateCompletion().reasons.join("\n"), /关键 BrowserClick/);

  ledger.observe({ name: "BrowserClick", input: { sessionId, pageId } }, {
    ok: true,
    metadata: { automation: { sessionId, pageId, url: previewUrl } }
  });
  assert.match(ledger.evaluateCompletion().reasons.join("\n"), /交互后/);
  observeHealthy(ledger, "BrowserInspect");
  observeHealthy(ledger, "BrowserScreenshot");
  assert.equal(ledger.evaluateCompletion().accepted, true);
});

test("browser runtime errors invalidate otherwise complete visual receipts", () => {
  const ledger = new RunProgressLedger({ task: "创建网页", visualVerificationAvailable: true });
  ledger.observe({ name: "Write" }, { ok: true, metadata: { path: "index.html" } });
  observePreview(ledger);
  ledger.observe({ name: "BrowserInspect", input: { sessionId, pageId } }, {
    ok: true,
    metadata: { automation: { sessionId, pageId, url: previewUrl, healthy: false, diagnostics: { pageErrors: ["boom"], consoleErrors: [] } } }
  });
  observeHealthy(ledger, "BrowserScreenshot");
  const decision = ledger.evaluateCompletion();
  assert.equal(decision.accepted, false);
  assert.match(decision.reasons.join("\n"), /pageerror/);
});

test("a later mutation invalidates the complete browser receipt chain", () => {
  const ledger = new RunProgressLedger({ task: "创建网页", visualVerificationAvailable: true });
  ledger.observe({ name: "Write" }, { ok: true, metadata: { path: "index.html" } });
  observePreview(ledger);
  observeHealthy(ledger, "BrowserInspect");
  observeHealthy(ledger, "BrowserScreenshot");
  assert.equal(ledger.evaluateCompletion().accepted, true);
  ledger.observe({ name: "Edit" }, { ok: true, metadata: { path: "index.html" } });
  const decision = ledger.evaluateCompletion();
  assert.equal(decision.accepted, false);
  assert.equal(decision.snapshot.visualVerificationAfterLatestMutation, false);
  assert.equal(decision.snapshot.previewPath, null);
});

test("completion ledger does not invent a browser gate when the capability snapshot lacks browser tools", () => {
  const ledger = new RunProgressLedger({ task: "创建 index.html", visualVerificationAvailable: false });
  ledger.observe({ name: "Write" }, { ok: true, metadata: { path: "index.html" } });
  assert.equal(ledger.evaluateCompletion().accepted, true);
});

test("completion ledger keeps structured todo work open until every item is completed", () => {
  const ledger = new RunProgressLedger({ task: "实现并验证功能" });
  ledger.observe({ name: "Write" }, { ok: true });
  ledger.observe({ name: "UpdateTodoList" }, {
    ok: true,
    metadata: { kind: "todo_list", todos: [
      { content: "实现功能", activeForm: "正在实现", status: "completed" },
      { content: "验证功能", activeForm: "正在验证", status: "in_progress" }
    ] }
  });
  assert.equal(ledger.evaluateCompletion().accepted, false);
  ledger.observe({ name: "UpdateTodoList" }, {
    ok: true,
    metadata: { kind: "todo_list", todos: [
      { content: "实现功能", activeForm: "正在实现", status: "completed" },
      { content: "验证功能", activeForm: "正在验证", status: "completed" }
    ] }
  });
  assert.equal(ledger.evaluateCompletion().accepted, true);
});
