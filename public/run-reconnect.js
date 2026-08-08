const terminalTypes = new Set(["agent_final", "agent_error", "agent_cancelled"]);

/** Derives renderer attachment state from the server session projection + JSONL. */
export function deriveRunAttachment(events = [], session = {}) {
  const latestRunId = session.latestRunId
    ?? [...events].reverse().find((event) => typeof event.data?.runId === "string")?.data?.runId;
  const startIndex = latestRunId ? events.findIndex((event) => event.data?.runId === latestRunId) : -1;
  const runStartEventCount = startIndex >= 0 ? startIndex : events.length;
  const runEvents = latestRunId ? events.slice(runStartEventCount).filter((event) => event.data?.runId === latestRunId) : [];
  const terminal = runEvents.some((event) => terminalTypes.has(event.type)
    || (event.type === "run_state_changed" && ["completed", "failed", "cancelled"].includes(event.data?.to)));
  return { latestRunId: latestRunId ?? null, runStartEventCount, running: Boolean(session.running) && !terminal };
}
