import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("project-scoped archive moves active Task journals without changing their facts", async () => {
  const stateRoot = await mkdtemp(join(tmpdir(), "codepilot-project-archive-"));
  process.env.CODEPILOT_STATE_ROOT = stateRoot;
  const store = await import(`../src/session-store.mjs?archive=${Date.now()}`);
  const first = await store.createSession("First task", { workspaceTargetId: "target-0123456789abcdef" });
  const second = await store.createSession("Second task", { workspaceTargetId: "target-0123456789abcdef" });

  assert.equal(await store.archiveSessionsForStateRoot(stateRoot), 2);
  assert.equal((await store.listSessionsForStateRoot(stateRoot)).length, 0);
  assert.deepEqual((await store.listSessionsForStateRoot(stateRoot, true)).map((session) => session.id).sort(), [first.id, second.id].sort());
  assert.equal((await store.getEvents(first.id))[0].data.workspaceTargetId, "target-0123456789abcdef");
});
