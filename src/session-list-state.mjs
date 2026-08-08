const terminalStates = new Set(["completed", "failed", "cancelled", "orphaned"]);

export function projectSessionListState(events) {
  const latestRunEvent = [...events].reverse().find((event) => typeof event.data?.runId === "string");
  const latestRunId = latestRunEvent?.data?.runId ?? null;
  if (!latestRunId) return { latestRunId: null, latestRunState: "idle", latestTerminalEventId: null, latestOutcome: null };

  const runEvents = events.filter((event) => event.data?.runId === latestRunId);
  const stateEvent = [...runEvents].reverse().find((event) => event.type === "run_state_changed");
  const finalEvent = [...runEvents].reverse().find((event) => ["agent_final", "agent_error", "agent_cancelled"].includes(event.type));
  const finalOutcome = finalEvent?.type === "agent_final"
    ? "completed"
    : finalEvent?.type === "agent_error"
      ? "failed"
      : finalEvent?.type === "agent_cancelled"
        ? "cancelled"
        : null;
  const orphanedEvent = [...runEvents].reverse().find((event) => event.type === "supervisor_run_orphaned");
  const latestRunState = orphanedEvent ? "orphaned" : finalOutcome ?? stateEvent?.data?.to ?? "preparing";
  const terminalEvent = orphanedEvent ?? finalEvent ?? (terminalStates.has(stateEvent?.data?.to) ? stateEvent : null);
  return {
    latestRunId,
    latestRunState,
    latestTerminalEventId: terminalEvent?.id ?? null,
    latestOutcome: terminalStates.has(latestRunState) ? latestRunState : null
  };
}
