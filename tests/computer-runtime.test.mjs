import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AutomationArtifactStore } from "../src/automation-artifact-store.mjs";
import { ComputerRuntime } from "../src/computer-runtime.mjs";

test("computer runtime owns opaque sessions and persists screenshot artifacts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-computer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const bridge = async (script, input) => {
    calls.push(input);
    if (script.includes("CopyFromScreen")) {
      await writeFile(input.path, Buffer.from("desktop-image"));
      return { width: 300, height: 200 };
    }
    if (script.includes("nodes=$result")) {
      return { nodes: [{ depth: 0, name: "Fixture", controlType: "Window" }], count: 1, truncated: false };
    }
    if (script.includes("$items =")) {
      return [{ hwnd: "42", title: "Fixture", processId: 7, bounds: { x: 1, y: 2, width: 300, height: 200 } }];
    }
    return { ok: true };
  };
  const runtime = new ComputerRuntime({
    artifactStore: new AutomationArtifactStore({ workspaceRoot: root }),
    createId: () => "00000000-0000-4000-8000-000000000042",
    bridge
  });

  const session = await runtime.start({ hwnd: "42" });
  assert.equal(session.sessionId, "00000000-0000-4000-8000-000000000042");
  assert.equal(session.title, "Fixture");
  const tree = await runtime.inspect({ sessionId: session.sessionId, maxNodes: 10, maxDepth: 2 });
  assert.equal(tree.nodes[0].controlType, "Window");
  const screenshot = await runtime.screenshot({ sessionId: session.sessionId });
  assert.equal(screenshot.artifact.width, 300);
  assert.equal((await runtime.artifactStore.read(screenshot.artifact.artifactId)).buffer.toString(), "desktop-image");
  await runtime.closeSession(session.sessionId);
  await assert.rejects(async () => runtime.inspect({ sessionId: session.sessionId }), /not found/i);
  assert.ok(calls.length >= 3);
});

test("computer runtime rejects stale window handles before creating a session", async () => {
  const runtime = new ComputerRuntime({
    artifactStore: { reserveImagePath() {}, commitReserved() {} },
    bridge: async () => []
  });
  await assert.rejects(runtime.start({ hwnd: "404" }), (error) => error.code === "COMPUTER_WINDOW_NOT_FOUND");
});
