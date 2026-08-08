import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDeliveryContract } from "../src/delivery-contract.mjs";
import { verifyDeliveryContract } from "../src/delivery-verifier.mjs";
import { RunProgressLedger } from "../src/run-progress-ledger.mjs";

test("shared delivery verifier builds the SDK browser and provider-vision evidence chain", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-delivery-verifier-"));
  await writeFile(join(root, "index.html"), "<button>Start</button>", "utf8");
  const contract = createDeliveryContract({ task: "创建 index.html 游戏", capabilities: { input: { image: true } }, browserToolsAvailable: true });
  const ledger = new RunProgressLedger({ task: "创建 index.html 游戏", deliveryContract: contract });
  ledger.observe({ name: "Bash" }, { ok: true, metadata: { fileChanges: [{ path: "index.html" }] } });
  const url = "http://127.0.0.1:4321/preview/index.html";
  const browserRuntime = {
    async startManaged() { return { sessionId: "session", pages: [{ pageId: "page" }] }; },
    async navigate() { return { sessionId: "session", pageId: "page", url, status: 200, title: "Game" }; },
    async inspect() { return { sessionId: "session", pageId: "page", url, healthy: true, diagnostics: { pageErrors: [], consoleErrors: [], httpErrors: [] }, externalContent: "button Start" }; },
    async screenshot() { return { sessionId: "session", pageId: "page", url, healthy: true, diagnostics: { pageErrors: [], consoleErrors: [], httpErrors: [] }, artifact: { artifactId: "shot.png" } }; },
    async click() { return { sessionId: "session", pageId: "page", url }; },
    async closeSession() {}
  };
  const evidence = [];
  const decision = await verifyDeliveryContract({
    contract, ledger, workspaceRoot: root, workspacePreviewOrigin: "http://127.0.0.1:4321", browserRuntime,
    changedPaths: ["index.html"], task: "创建 index.html 游戏",
    visualReviewer: async ({ revision }) => ({ ok: true, content: "ok", metadata: { accepted: true, revision } }),
    onEvidence: (item) => evidence.push(item.name)
  });
  assert.equal(decision.accepted, true);
  assert.equal(evidence.includes("ProviderVisualReview"), true);
  assert.equal(ledger.snapshot().verifiedInteractionCount, 1);
});
