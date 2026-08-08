export function deriveSessionAttention(session, seenTerminalEventIds) {
  if (session?.running) return "running";
  if (
    session?.latestOutcome === "completed"
    && session.latestTerminalEventId
    && !seenTerminalEventIds.has(session.latestTerminalEventId)
  ) return "completed_unread";
  return "idle";
}

export function countUnreadCompletions(sessions, seenTerminalEventIds) {
  return sessions.filter((session) => deriveSessionAttention(session, seenTerminalEventIds) === "completed_unread").length;
}

export function baselineSeenTerminalEventIds(sessions, seenTerminalEventIds = new Set()) {
  const baseline = new Set(seenTerminalEventIds);
  for (const session of sessions) {
    if (session?.latestTerminalEventId) baseline.add(session.latestTerminalEventId);
  }
  return baseline;
}

export function restoreSeenTerminalEventIds(storageValue) {
  try {
    const values = JSON.parse(storageValue ?? "[]");
    return new Set(Array.isArray(values) ? values.filter((value) => typeof value === "string").slice(-400) : []);
  } catch {
    return new Set();
  }
}

export function persistSeenTerminalEventIds(seenTerminalEventIds) {
  return JSON.stringify([...seenTerminalEventIds].slice(-400));
}
