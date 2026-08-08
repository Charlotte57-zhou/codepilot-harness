import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { createSession, appendEvent, deleteSession, getEvents, getEventsSince, listSessions, listSessionsForStateRoot, loadSessionSnapshot, projectActivityProjection, renameWithRetry, saveSessionSnapshot } from "../src/session-store.mjs";

const targetMetadata = Object.freeze({ workspaceTargetId: "target-0123456789abcdef" });

test("project activity derives real token totals, streaks, and a bounded calendar", () => {
  const event = (timestamp, inputTokens, outputTokens) => ({
    type: "token_usage_recorded",
    timestamp,
    data: { usage: { inputTokens, outputTokens } }
  });
  const activity = projectActivityProjection([
    event("2026-08-03T08:00:00.000Z", 10, 5),
    event("2026-08-04T08:00:00.000Z", 20, 5),
    event("2026-08-04T10:00:00.000Z", 5, 5),
    event("2026-08-06T08:00:00.000Z", 30, 10),
    event("2026-08-07T08:00:00.000Z", 40, 10),
    { type: "assistant_message", timestamp: "2026-08-07T09:00:00.000Z", data: {} }
  ], { today: new Date("2026-08-07T12:00:00"), windowDays: 7 });

  assert.equal(activity.totalTokens, 140);
  assert.equal(activity.peakDailyTokens, 50);
  assert.equal(activity.currentStreakDays, 2);
  assert.equal(activity.longestStreakDays, 2);
  assert.equal(activity.days.length, 7);
  assert.deepEqual(activity.days.slice(-2), [
    { date: "2026-08-06", tokens: 40 },
    { date: "2026-08-07", tokens: 50 }
  ]);
});

test("project activity returns explicit zero values for an empty journal", () => {
  assert.deepEqual(projectActivityProjection([], { today: new Date("2026-08-07T12:00:00"), windowDays: 2 }), {
    totalTokens: 0,
    peakDailyTokens: 0,
    currentStreakDays: 0,
    longestStreakDays: 0,
    days: [
      { date: "2026-08-06", tokens: 0 },
      { date: "2026-08-07", tokens: 0 }
    ]
  });
});

test("atomic index rename retries transient Windows file locks", async () => {
  let attempts = 0;
  await renameWithRetry("source", "target", {
    attempts: 4,
    baseDelayMs: 0,
    sleep: async () => {},
    renameImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("locked"), { code: "EPERM" });
    }
  });
  assert.equal(attempts, 3);
});

test("cross-project session navigation is a read-only projection of another state root", async () => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-navigation-"));
  const directory = join(root, ".codepilot", "sessions");
  await mkdir(directory, { recursive: true });
  const timestamp = "2026-08-05T01:02:03.000Z";
  const event = {
    id: "event-navigation-1",
    schemaVersion: 1,
    sequence: 1,
    type: "session_started",
    timestamp,
    data: { id: "session-navigation", title: "Other Project Task", createdAt: timestamp, kind: "primary", workspaceTargetId: targetMetadata.workspaceTargetId }
  };
  const sealed = { ...event, checksum: createHash("sha256").update(JSON.stringify(event)).digest("hex") };
  await writeFile(join(directory, "session-navigation.jsonl"), `${JSON.stringify(sealed)}\n`, "utf8");
  await writeFile(join(directory, "session-corrupt.jsonl"), "{broken\n", "utf8");

  const sessions = await listSessionsForStateRoot(root);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "Other Project Task");
  assert.deepEqual((await readdir(directory)).sort(), ["session-corrupt.jsonl", "session-navigation.jsonl"]);
  await rm(root, { recursive: true, force: true });
});

test("a session persists ordered JSONL events", async () => {
  const session = await createSession("Session store test", targetMetadata);
  try {
    await appendEvent(session.id, "user_message", { content: "Hello Agent" });
    const events = await getEvents(session.id);

    assert.equal(events[0].type, "session_started");
    assert.equal(events[1].type, "user_message");
    assert.equal(events[1].data.content, "Hello Agent");
  } finally {
    await deleteSession(session.id);
  }
});

test("incremental session reads return only events after the durable sequence", async () => {
  const session = await createSession("Incremental store test", targetMetadata);
  try {
    await appendEvent(session.id, "probe", { value: 1 });
    const cursor = (await getEvents(session.id)).at(-1).sequence;
    await appendEvent(session.id, "probe", { value: 2 });
    await appendEvent(session.id, "probe", { value: 3 });
    const delta = await getEventsSince(session.id, cursor);
    assert.deepEqual(delta.map((event) => event.data.value), [2, 3]);
  } finally {
    await deleteSession(session.id);
  }
});

test("a derived index refresh failure does not fail the durable journal append", async () => {
  const session = await createSession("Derived index failure test", targetMetadata);
  const index = join(process.cwd(), ".codepilot", "sessions", `${session.id}.index.json`);
  try {
    await rm(index, { force: true });
    await mkdir(index);
    const appended = await appendEvent(session.id, "user_message", { content: "durable despite index failure" });
    const events = await getEvents(session.id);
    assert.equal(events.some((event) => event.id === appended.id && event.data.content === "durable despite index failure"), true);
    assert.equal(events.at(-1).type, "session_index_refresh_failed");
  } finally {
    await rm(index, { recursive: true, force: true });
    await deleteSession(session.id);
  }
});

test("concurrent session writes are serialized with sequence and checksum metadata", async () => {
  const session = await createSession("Concurrent store test", targetMetadata);
  try {
    await Promise.all(Array.from({ length: 12 }, (_, index) => appendEvent(session.id, "probe", { index })));
    const events = await getEvents(session.id);
    assert.deepEqual(events.map((event) => event.sequence), Array.from({ length: 13 }, (_, index) => index + 1));
    assert.ok(events.every((event) => event.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(event.checksum)));

    await saveSessionSnapshot(session.id, { state: "sampling", messages: [] });
    const snapshot = await loadSessionSnapshot(session.id);
    assert.equal(snapshot.transcriptCursor.sequence, 13);
    assert.equal(snapshot.transcriptCursor.eventId, events.at(-1).id);
  } finally {
    await deleteSession(session.id);
  }
});

test("a truncated final JSONL line is ignored during recovery", async () => {
  const session = await createSession("Truncated tail test", targetMetadata);
  const path = join(process.cwd(), ".codepilot", "sessions", `${session.id}.jsonl`);
  try {
    await appendEvent(session.id, "user_message", { content: "durable" });
    await appendFile(path, '{"type":"partial"', "utf8");
    const events = await getEvents(session.id);
    assert.equal(events.at(-1).data.content, "durable");
    assert.equal(events.length, 2);
  } finally {
    await deleteSession(session.id);
  }
});

test("the next append physically repairs a truncated tail and records the repair", async () => {
  const session = await createSession("Tail repair test", targetMetadata);
  const path = join(process.cwd(), ".codepilot", "sessions", `${session.id}.jsonl`);
  try {
    await appendEvent(session.id, "user_message", { content: "durable" });
    await appendFile(path, '{"type":"partial"', "utf8");
    await appendEvent(session.id, "user_message", { content: "after repair" });

    const events = await getEvents(session.id);
    assert.deepEqual(events.slice(-2).map((event) => event.type), ["journal_tail_repaired", "user_message"]);
    assert.equal(events.at(-2).data.discardedBytes > 0, true);
    assert.equal((await readFile(path, "utf8")).endsWith("\n"), true);
  } finally {
    await deleteSession(session.id);
  }
});

test("middle corruption is quarantined instead of silently skipped", async () => {
  const session = await createSession("Corruption quarantine test", targetMetadata);
  const directory = join(process.cwd(), ".codepilot", "sessions");
  const path = join(directory, `${session.id}.jsonl`);
  try {
    const content = await readFile(path, "utf8");
    await writeFile(path, `${content}not-json\n`, "utf8");
    await appendEvent(session.id, "probe", { value: 1 });
    assert.fail("append should reject a corrupt middle line");
  } catch (error) {
    assert.match(error.message, /corrupt at line/);
    const quarantineFiles = (await readdir(directory)).filter((name) => name.startsWith(`${session.id}.corrupt-`));
    assert.equal(quarantineFiles.some((name) => name.endsWith(".bin")), true);
    assert.equal(quarantineFiles.some((name) => name.endsWith(".json")), true);
  } finally {
    await deleteSession(session.id);
  }
});

test("session snapshots reject path traversal ids", async () => {
  await assert.rejects(() => saveSessionSnapshot("../outside", {}), /Invalid session id/);
  await assert.rejects(() => loadSessionSnapshot("../outside"), /Invalid session id/);
});

test("session listing orders conversations by their latest activity", async () => {
  const older = await createSession("older", targetMetadata);
  await new Promise((resolve) => setTimeout(resolve, 5));
  const newer = await createSession("newer", targetMetadata);
  try {
    await new Promise((resolve) => setTimeout(resolve, 5));
    await appendEvent(older.id, "user_message", { content: "active again" });
    const sessions = await listSessions();
    assert.ok(sessions.findIndex((session) => session.id === older.id) < sessions.findIndex((session) => session.id === newer.id));
  } finally {
    await deleteSession(older.id);
    await deleteSession(newer.id);
  }
});
