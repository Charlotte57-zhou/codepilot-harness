import { mkdir, readdir, readFile, appendFile, writeFile, rename, unlink, open, stat, truncate } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { projectSessionListState } from "./session-list-state.mjs";
import { isWorkspaceTargetId } from "./workspace-target-identity.mjs";

export function sessionDirectoryForStateRoot(stateRoot = process.env.CODEPILOT_STATE_ROOT ?? process.cwd()) {
  return join(resolve(stateRoot), ".codepilot", "sessions");
}

const sessionsDirectory = sessionDirectoryForStateRoot();
const eventSchemaVersion = 1;
const writeQueues = new Map();
const journalCaches = new Map();

function assertSessionId(sessionId) {
  if (typeof sessionId !== "string" || !/^[a-z0-9-]+$/i.test(sessionId)) throw new Error("Invalid session id");
  return sessionId;
}

function calendarDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addCalendarDays(value, amount) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + amount);
  return calendarDay(date);
}

export function projectActivityProjection(events, { today = new Date(), windowDays = 365 } = {}) {
  const boundedWindow = Math.max(1, Math.min(366, Number(windowDays) || 365));
  const totalsByDay = new Map();
  let totalTokens = 0;
  for (const event of events ?? []) {
    if (event?.type !== "token_usage_recorded") continue;
    const usage = event.data?.usage ?? {};
    const tokens = Math.max(0, Number(usage.inputTokens) || 0) + Math.max(0, Number(usage.outputTokens) || 0);
    const day = calendarDay(event.timestamp);
    if (!day || tokens <= 0) continue;
    totalTokens += tokens;
    totalsByDay.set(day, (totalsByDay.get(day) ?? 0) + tokens);
  }

  const activeDays = [...totalsByDay.keys()].sort();
  let longestStreakDays = 0;
  let streak = 0;
  let previous = null;
  for (const day of activeDays) {
    streak = previous && addCalendarDays(previous, 1) === day ? streak + 1 : 1;
    longestStreakDays = Math.max(longestStreakDays, streak);
    previous = day;
  }

  const todayKey = calendarDay(today);
  let currentStreakDays = 0;
  for (let cursor = todayKey; cursor && totalsByDay.has(cursor); cursor = addCalendarDays(cursor, -1)) currentStreakDays += 1;
  const start = addCalendarDays(todayKey, -(boundedWindow - 1));
  const days = Array.from({ length: boundedWindow }, (_, index) => {
    const date = addCalendarDays(start, index);
    return Object.freeze({ date, tokens: totalsByDay.get(date) ?? 0 });
  });

  return Object.freeze({
    totalTokens,
    peakDailyTokens: totalsByDay.size ? Math.max(...totalsByDay.values()) : 0,
    currentStreakDays,
    longestStreakDays,
    days: Object.freeze(days)
  });
}

const snapshotPath = (sessionId) => join(sessionsDirectory, `${assertSessionId(sessionId)}.snapshot.json`);
const indexPath = (sessionId) => join(sessionsDirectory, `${assertSessionId(sessionId)}.index.json`);
const lockPath = (sessionId) => join(sessionsDirectory, `${assertSessionId(sessionId)}.lock`);

const transientRenameCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

export async function renameWithRetry(source, target, {
  attempts = 5,
  baseDelayMs = 35,
  renameImpl = rename,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs))
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await renameImpl(source, target);
    } catch (error) {
      lastError = error;
      if (!transientRenameCodes.has(error?.code) || attempt === attempts) throw error;
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  throw lastError;
}

function sessionPath(sessionId, archived = false) {
  return join(sessionsDirectory, `${assertSessionId(sessionId)}${archived ? ".archived" : ""}.jsonl`);
}

async function existingPath(sessionId) {
  for (const archived of [false, true]) {
    try {
      await readFile(sessionPath(sessionId, archived), "utf8");
      return sessionPath(sessionId, archived);
    } catch {
      // Try the other session state.
    }
  }
  throw new Error("Session not found");
}

function checksumFor(event) {
  return createHash("sha256").update(JSON.stringify(event)).digest("hex");
}

function sealEvent(event) {
  return { ...event, checksum: checksumFor(event) };
}

class SessionJournalCorruptionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SessionJournalCorruptionError";
    this.details = details;
  }
}

function parseJournalBuffer(buffer, { tolerateTruncatedTail = true } = {}) {
  const events = [];
  let offset = 0;
  let lineNumber = 0;
  let truncatedTailOffset = null;
  let needsTrailingNewline = false;

  while (offset < buffer.length) {
    const newline = buffer.indexOf(0x0a, offset);
    const lineEnd = newline === -1 ? buffer.length : newline;
    const raw = buffer.subarray(offset, lineEnd);
    const line = raw.toString("utf8").trim();
    lineNumber += 1;
    if (!line) {
      offset = newline === -1 ? buffer.length : newline + 1;
      continue;
    }
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      const isTail = newline === -1;
      if (tolerateTruncatedTail && isTail) {
        truncatedTailOffset = offset;
        break;
      }
      throw new SessionJournalCorruptionError(
        `Session transcript is corrupt at line ${lineNumber}: ${error.message}`,
        { lineNumber, byteOffset: offset, raw }
      );
    }
    if (event.checksum) {
      const { checksum, ...payload } = event;
      if (checksumFor(payload) !== checksum) {
        throw new SessionJournalCorruptionError(
          `Session transcript checksum mismatch at line ${lineNumber}`,
          { lineNumber, byteOffset: offset, raw }
        );
      }
    }
    events.push(event);
    if (newline === -1) needsTrailingNewline = true;
    offset = newline === -1 ? buffer.length : newline + 1;
  }
  return { events, truncatedTailOffset, needsTrailingNewline };
}

async function quarantineCorruption(sessionId, error) {
  const id = `${Date.now()}-${randomUUID()}`;
  const base = join(sessionsDirectory, `${assertSessionId(sessionId)}.corrupt-${id}`);
  const raw = error.details?.raw ?? Buffer.alloc(0);
  await writeFile(`${base}.bin`, raw);
  await writeFile(`${base}.json`, JSON.stringify({
    schemaVersion: eventSchemaVersion,
    sessionId,
    detectedAt: new Date().toISOString(),
    lineNumber: error.details?.lineNumber ?? null,
    byteOffset: error.details?.byteOffset ?? null,
    byteLength: raw.length,
    reason: error.message
  }), "utf8");
  return base;
}

async function readJournalAtPath(sessionId, path, { repairTail = false } = {}) {
  const buffer = await readFile(path);
  let parsed;
  try {
    parsed = parseJournalBuffer(buffer);
  } catch (error) {
    if (!(error instanceof SessionJournalCorruptionError)) throw error;
    const quarantineBase = await quarantineCorruption(sessionId, error);
    error.quarantineBase = quarantineBase;
    throw error;
  }

  let repairedBytes = 0;
  if (repairTail && parsed.truncatedTailOffset !== null) {
    repairedBytes = buffer.length - parsed.truncatedTailOffset;
    await truncate(path, parsed.truncatedTailOffset);
  } else if (repairTail && parsed.needsTrailingNewline) {
    await appendFile(path, "\n", "utf8");
  }
  return { ...parsed, repairedBytes };
}

async function readJournal(sessionId, options = {}) {
  return readJournalAtPath(sessionId, sessionPath(sessionId), options);
}

async function loadJournalState(sessionId, path, { repairTail = false } = {}) {
  const fileSize = (await stat(path)).size;
  const cached = journalCaches.get(sessionId);
  if (cached?.path === path && cached.fileSize === fileSize && !repairTail) return cached;
  if (cached?.path === path && cached.fileSize === fileSize && repairTail && !cached.truncatedTailOffset && !cached.needsTrailingNewline) return cached;
  const inspected = await readJournalAtPath(sessionId, path, { repairTail });
  const repairedFileSize = (await stat(path)).size;
  const state = {
    path,
    fileSize: repairedFileSize,
    events: inspected.events,
    truncatedTailOffset: inspected.truncatedTailOffset,
    needsTrailingNewline: inspected.needsTrailingNewline,
    repairedBytes: inspected.repairedBytes
  };
  journalCaches.set(sessionId, state);
  return state;
}

function cacheAppendedEvent(sessionId, path, event, bytes) {
  const cached = journalCaches.get(sessionId);
  if (!cached || cached.path !== path) return;
  cached.events.push(event);
  cached.fileSize += bytes;
}

function enqueueSessionWrite(sessionId, operation) {
  const previous = writeQueues.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  writeQueues.set(sessionId, next);
  void next.finally(() => {
    if (writeQueues.get(sessionId) === next) writeQueues.delete(sessionId);
  }).catch(() => {});
  return next;
}

async function withSessionLock(sessionId, operation) {
  await mkdir(sessionsDirectory, { recursive: true });
  const path = lockPath(sessionId);
  let handle;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }), "utf8");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(path);
        if (Date.now() - lockStat.mtimeMs > 30_000) await unlink(path);
      } catch (lockError) {
        if (lockError.code !== "ENOENT") throw lockError;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!handle) throw new Error(`Timed out acquiring session lock for ${sessionId}`);
  try {
    return await operation();
  } finally {
    await handle.close();
    try { await unlink(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function writeIndex(sessionId, event, fileSize) {
  const target = indexPath(sessionId);
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify({
    schemaVersion: eventSchemaVersion,
    lastSequence: event.sequence,
    lastEventId: event.id,
    lastChecksum: event.checksum,
    fileSize,
    updatedAt: event.timestamp
  }), "utf8");
  try {
    await renameWithRetry(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

async function readIndexedTail(path, fileSize) {
  if (fileSize <= 0) return null;
  const readSize = Math.min(fileSize, 1024 * 1024);
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(readSize);
    const { bytesRead } = await handle.read(buffer, 0, readSize, fileSize - readSize);
    const slice = buffer.subarray(0, bytesRead);
    let end = slice.length;
    while (end > 0 && (slice[end - 1] === 0x0a || slice[end - 1] === 0x0d)) end -= 1;
    const previousNewline = slice.lastIndexOf(0x0a, end - 1);
    if (previousNewline === -1 && readSize < fileSize) return null;
    const line = slice.subarray(previousNewline + 1, end).toString("utf8").trim();
    return line ? JSON.parse(line) : null;
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

async function loadUsableIndex(sessionId, fileSize, journalPath = sessionPath(sessionId)) {
  try {
    const index = JSON.parse(await readFile(indexPath(sessionId), "utf8"));
    if (
      index.schemaVersion === eventSchemaVersion
      && index.fileSize === fileSize
      && Number.isInteger(index.lastSequence)
      && typeof index.lastEventId === "string"
      && typeof index.lastChecksum === "string"
    ) {
      const tail = await readIndexedTail(journalPath, fileSize);
      if (
        tail?.id === index.lastEventId
        && tail?.sequence === index.lastSequence
        && tail?.checksum === index.lastChecksum
      ) return index;
    }
  } catch {
    // A missing or stale index is rebuilt from the journal under the session lock.
  }
  return null;
}

export async function createSession(title, metadata = {}) {
  await mkdir(sessionsDirectory, { recursive: true });
  const id = randomUUID();
  const normalizedTitle = normalizeSessionTitle(title, "Untitled session");
  const workspaceTargetId = metadata.workspaceTargetId;
  if (!isWorkspaceTargetId(workspaceTargetId)) throw new TypeError("workspaceTargetId must be a valid Workspace Target ID");
  const session = {
    id,
    title: normalizedTitle,
    createdAt: new Date().toISOString(),
    kind: metadata.kind === "sidechain" ? "sidechain" : "primary",
    parentSessionId: metadata.parentSessionId,
    parentRunId: metadata.parentRunId,
    workspaceTargetId
  };
  const event = sealEvent({ id: randomUUID(), schemaVersion: eventSchemaVersion, sequence: 1, type: "session_started", timestamp: session.createdAt, data: session });
  await writeFile(sessionPath(id), `${JSON.stringify(event)}\n`, "utf8");
  await writeIndex(id, event, (await stat(sessionPath(id))).size);
  return session;
}

export async function saveSessionSnapshot(sessionId, snapshot) {
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    const { events } = await readJournal(sessionId);
    const cursor = events.at(-1);
    const path = snapshotPath(sessionId);
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temporary, JSON.stringify({
      ...snapshot,
      sessionId,
      transcriptCursor: { sequence: cursor?.sequence ?? events.length, eventId: cursor?.id ?? null },
      updatedAt: new Date().toISOString()
    }), "utf8");
    await rename(temporary, path);
  }));
}

export async function loadSessionSnapshot(sessionId) {
  try { return JSON.parse(await readFile(snapshotPath(sessionId), "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function appendEventAtPath(sessionId, path, type, data = {}) {
    const state = await loadJournalState(sessionId, path, { repairTail: true });
    let previous = state.events.at(-1);
    const repairedBytes = state.repairedBytes ?? 0;
    if (repairedBytes > 0) {
      const repairEvent = sealEvent({
        id: randomUUID(),
        schemaVersion: eventSchemaVersion,
        sequence: Number(previous?.sequence ?? 0) + 1,
        type: "journal_tail_repaired",
        timestamp: new Date().toISOString(),
        data: { discardedBytes: repairedBytes }
      });
      const line = `${JSON.stringify(repairEvent)}\n`;
      await appendFile(path, line, "utf8");
      cacheAppendedEvent(sessionId, path, repairEvent, Buffer.byteLength(line));
      previous = repairEvent;
      state.repairedBytes = 0;
    }
    const event = sealEvent({
      id: randomUUID(),
      schemaVersion: eventSchemaVersion,
      sequence: Number(previous?.sequence ?? 0) + 1,
      type,
      timestamp: new Date().toISOString(),
      data
    });
    const line = `${JSON.stringify(event)}\n`;
    await appendFile(path, line, "utf8");
    cacheAppendedEvent(sessionId, path, event, Buffer.byteLength(line));
    try {
      await writeIndex(sessionId, event, state.fileSize);
    } catch (error) {
      // JSONL is the fact source. A derived index refresh failure must not
      // retroactively fail a durable append. Record one journal diagnostic and
      // let the next read rebuild the index/cache from JSONL.
      const diagnostic = sealEvent({
        id: randomUUID(),
        schemaVersion: eventSchemaVersion,
        sequence: event.sequence + 1,
        type: "session_index_refresh_failed",
        timestamp: new Date().toISOString(),
        data: { code: transientRenameCodes.has(error?.code) ? error.code : "INDEX_REFRESH_FAILED" }
      });
      const diagnosticLine = `${JSON.stringify(diagnostic)}\n`;
      await appendFile(path, diagnosticLine, "utf8");
      cacheAppendedEvent(sessionId, path, diagnostic, Buffer.byteLength(diagnosticLine));
    }
    return event;
}

export function normalizeSessionTitle(title, fallback = "") {
  if (typeof title !== "string") return fallback;
  const normalized = title.trim().replace(/\s+/g, " ");
  return normalized ? normalized.slice(0, 80) : fallback;
}

export async function appendEvent(sessionId, type, data = {}) {
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    return appendEventAtPath(sessionId, sessionPath(sessionId), type, data);
  }));
}

export async function renameSession(sessionId, title, { source = "user" } = {}) {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) {
    const error = new Error("Session title must be a non-empty string");
    error.statusCode = 400;
    throw error;
  }
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    const path = await existingPath(sessionId);
    const event = await appendEventAtPath(sessionId, path, "session_renamed", {
      title: normalizedTitle,
      source: source === "model" ? "model" : "user"
    });
    return { id: assertSessionId(sessionId), title: normalizedTitle, updatedAt: event.timestamp };
  }));
}

export async function renameSessionFromModel(sessionId, title, { runId } = {}) {
  const normalizedTitle = normalizeSessionTitle(title);
  if (!normalizedTitle) return { applied: false, reason: "empty_title" };
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    const path = await existingPath(sessionId);
    const { events } = await readJournalAtPath(sessionId, path);
    if (events.some((event) => event.type === "session_renamed" && event.data?.source === "user")) {
      return { applied: false, reason: "user_owned" };
    }
    const event = await appendEventAtPath(sessionId, path, "session_renamed", {
      title: normalizedTitle,
      source: "model",
      runId
    });
    return { applied: true, event };
  }));
}

export async function getEvents(sessionId) {
  const path = await existingPath(sessionId);
  return [...(await loadJournalState(sessionId, path)).events];
}

export async function getEventsSince(sessionId, afterSequence = 0) {
  const sequence = Number(afterSequence);
  if (!Number.isInteger(sequence) || sequence < 0) throw new RangeError("afterSequence must be a non-negative integer");
  const events = await getEvents(sessionId);
  return sequence === 0 ? events : events.filter((event) => event.sequence > sequence);
}

async function listByState(archived, includeSidechains = false, {
  directory = sessionsDirectory,
  createIfMissing = true,
  quarantineOnCorruption = true
} = {}) {
  if (createIfMissing) await mkdir(directory, { recursive: true });
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!createIfMissing && error.code === "ENOENT") return [];
    throw error;
  }
  const sessions = await Promise.all(entries
    .filter((entry) => entry.isFile() && (archived ? entry.name.endsWith(".archived.jsonl") : entry.name.endsWith(".jsonl") && !entry.name.endsWith(".archived.jsonl")))
    .map(async (entry) => {
      try {
        const buffer = await readFile(join(directory, entry.name));
        const events = parseJournalBuffer(buffer).events;
        const [firstEvent] = events;
        const renameEvent = [...events].reverse().find((event) => event.type === "session_renamed" && event.data?.title);
        if (!firstEvent) return null;
        if (!isWorkspaceTargetId(firstEvent.data?.workspaceTargetId)) throw new Error(`Session ${firstEvent.data?.id ?? entry.name} is missing a current workspaceTargetId`);
        const updatedAt = events.at(-1)?.timestamp ?? firstEvent.data.createdAt;
        return {
          ...firstEvent.data,
          title: renameEvent?.data.title ?? firstEvent.data.title,
          updatedAt,
          archived,
          ...projectSessionListState(events)
        };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        if (error instanceof SessionJournalCorruptionError) {
          if (!quarantineOnCorruption) return null;
          const sessionId = entry.name.replace(/(?:\.archived)?\.jsonl$/, "");
          error.quarantineBase = await quarantineCorruption(sessionId, error);
        }
        throw error;
      }
    }));
  return sessions.filter((session) => session && (includeSidechains || session.kind !== "sidechain")).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listSessions(archived = false, { includeSidechains = false } = {}) {
  return listByState(archived, includeSidechains);
}

export async function listSessionsForStateRoot(stateRoot, archived = false, { includeSidechains = false } = {}) {
  if (!stateRoot) throw new TypeError("stateRoot is required");
  return listByState(archived, includeSidechains, {
    directory: sessionDirectoryForStateRoot(stateRoot),
    createIfMissing: false,
    quarantineOnCorruption: false
  });
}

async function activityEventsForDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const journals = entries.filter((entry) => entry.isFile() && /(?:\.archived)?\.jsonl$/.test(entry.name));
  const collections = await Promise.all(journals.map(async (entry) => {
    try {
      const events = parseJournalBuffer(await readFile(join(directory, entry.name))).events;
      return events[0]?.data?.kind === "sidechain" ? [] : events;
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SessionJournalCorruptionError) return [];
      throw error;
    }
  }));
  return collections.flat();
}

export async function projectActivity({ today = new Date(), windowDays = 365 } = {}) {
  return projectActivityProjection(await activityEventsForDirectory(sessionsDirectory), { today, windowDays });
}

export async function projectActivityForStateRoot(stateRoot, { today = new Date(), windowDays = 365 } = {}) {
  if (!stateRoot) throw new TypeError("stateRoot is required");
  return projectActivityProjection(await activityEventsForDirectory(sessionDirectoryForStateRoot(stateRoot)), { today, windowDays });
}

export async function archiveSessionsForStateRoot(stateRoot) {
  if (!stateRoot) throw new TypeError("stateRoot is required");
  const directory = sessionDirectoryForStateRoot(stateRoot);
  const sessions = await listSessionsForStateRoot(stateRoot);
  await Promise.all(sessions.map((session) => rename(
    join(directory, `${assertSessionId(session.id)}.jsonl`),
    join(directory, `${session.id}.archived.jsonl`)
  )));
  return sessions.length;
}

export async function restoreSessionForStateRoot(stateRoot, sessionId) {
  if (!stateRoot) throw new TypeError("stateRoot is required");
  const directory = sessionDirectoryForStateRoot(stateRoot);
  const id = assertSessionId(sessionId);
  await rename(join(directory, `${id}.archived.jsonl`), join(directory, `${id}.jsonl`));
}

export async function deleteSessionForStateRoot(stateRoot, sessionId) {
  if (!stateRoot) throw new TypeError("stateRoot is required");
  const directory = sessionDirectoryForStateRoot(stateRoot);
  const id = assertSessionId(sessionId);
  for (const suffix of [".jsonl", ".archived.jsonl", ".snapshot.json", ".index.json"]) {
    try { await unlink(join(directory, `${id}${suffix}`)); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export async function archiveSession(sessionId) {
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    await rename(sessionPath(sessionId), sessionPath(sessionId, true));
    journalCaches.delete(sessionId);
  }));
}

export async function restoreSession(sessionId) {
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    await rename(sessionPath(sessionId, true), sessionPath(sessionId));
    journalCaches.delete(sessionId);
  }));
}

export async function deleteSession(sessionId) {
  return enqueueSessionWrite(sessionId, () => withSessionLock(sessionId, async () => {
    journalCaches.delete(sessionId);
    for (const archived of [false, true]) {
      try {
        await unlink(sessionPath(sessionId, archived));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    for (const path of [snapshotPath(sessionId), indexPath(sessionId)]) {
      try { await unlink(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    }
    const prefix = `${assertSessionId(sessionId)}.corrupt-`;
    for (const entry of await readdir(sessionsDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.startsWith(prefix)) continue;
      await unlink(join(sessionsDirectory, entry.name));
    }
  }));
}
