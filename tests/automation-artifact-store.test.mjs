import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AutomationArtifactStore } from "../src/automation-artifact-store.mjs";

test("automation artifacts are atomically stored behind opaque ids", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-artifacts-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new AutomationArtifactStore({
    workspaceRoot: root,
    createId: () => "00000000-0000-4000-8000-000000000001",
    now: () => Date.parse("2026-07-20T00:00:00.000Z")
  });

  const record = await store.saveImage(Buffer.from("fixture-image"), {
    kind: "browser_screenshot",
    sessionId: "fixture-session",
    width: 640,
    height: 480
  });
  assert.equal(record.url, "/api/automation/artifacts/00000000-0000-4000-8000-000000000001.png");
  assert.equal(record.bytes, 13);
  assert.equal(record.width, 640);
  assert.equal(record.createdAt, "2026-07-20T00:00:00.000Z");

  const loaded = await store.read(record.artifactId);
  assert.equal(loaded.buffer.toString(), "fixture-image");
  assert.equal(loaded.contentType, "image/png");
  assert.deepEqual(loaded.metadata, record);
  assert.throws(() => store.resolvePath("../outside.png"), /Invalid automation artifact id/);
});

