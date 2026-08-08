import test from "node:test";
import assert from "node:assert/strict";
import { appendEvent, archiveSession, createSession, deleteSession, getEvents, listSessions, normalizeSessionTitle, renameSession, renameSessionFromModel, restoreSession } from "../src/session-store.mjs";

const targetMetadata = Object.freeze({ workspaceTargetId: "target-0123456789abcdef" });

test("sessions can be archived, restored, and deleted", async () => {
  const session = await createSession("Lifecycle test", targetMetadata);
  await appendEvent(session.id, "user_message", { content: "test" });
  await appendEvent(session.id, "session_renamed", { title: "Renamed lifecycle session" });

  assert.equal((await listSessions(false)).find((item) => item.id === session.id)?.title, "Renamed lifecycle session");
  await archiveSession(session.id);
  assert.equal((await listSessions(false)).some((item) => item.id === session.id), false);
  assert.equal((await listSessions(true)).some((item) => item.id === session.id), true);
  assert.equal((await getEvents(session.id)).length, 3);
  await renameSession(session.id, "  Archived   title  ");
  assert.equal((await listSessions(true)).find((item) => item.id === session.id)?.title, "Archived title");

  await restoreSession(session.id);
  assert.equal((await listSessions(false)).some((item) => item.id === session.id), true);
  await deleteSession(session.id);
  assert.equal((await listSessions(false)).some((item) => item.id === session.id), false);
  assert.equal((await listSessions(true)).some((item) => item.id === session.id), false);
});

test("session titles are normalized and user renames are durable facts", async () => {
  assert.equal(normalizeSessionTitle("  compact   title  "), "compact title");
  assert.equal(normalizeSessionTitle("   ", "Fallback"), "Fallback");
  const session = await createSession("Initial title", targetMetadata);
  await renameSession(session.id, "User title");
  const event = (await getEvents(session.id)).at(-1);
  assert.equal(event.type, "session_renamed");
  assert.deepEqual(event.data, { title: "User title", source: "user" });
  await assert.rejects(() => renameSession(session.id, "   "), /non-empty/);
  await deleteSession(session.id);
});

test("a user-owned title wins over a late model-generated title", async () => {
  const session = await createSession("Initial title", targetMetadata);
  await renameSession(session.id, "My title");
  const result = await renameSessionFromModel(session.id, "Generated title", { runId: "run-1" });
  assert.deepEqual(result, { applied: false, reason: "user_owned" });
  assert.equal((await listSessions(false)).find((item) => item.id === session.id)?.title, "My title");
  await deleteSession(session.id);
});

test("session_started requires and freezes a current Workspace Target identity", async () => {
  const targetId = "target-0123456789abcdef";
  const targeted = await createSession("Worktree task", { workspaceTargetId: targetId });
  try {
    assert.equal(targeted.workspaceTargetId, targetId);
    assert.equal((await getEvents(targeted.id))[0].data.workspaceTargetId, targetId);
    assert.equal((await listSessions(false)).find((item) => item.id === targeted.id)?.workspaceTargetId, targetId);
    await assert.rejects(() => createSession("Missing target"), /valid Workspace Target ID/);
    await assert.rejects(() => createSession("Invalid target", { workspaceTargetId: "target-invalid" }), /valid Workspace Target ID/);
  } finally {
    await deleteSession(targeted.id);
  }
});
