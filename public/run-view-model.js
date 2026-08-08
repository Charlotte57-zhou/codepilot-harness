const terminalStates = new Set(["completed", "failed", "cancelled", "orphaned"]);

function timestamp(value) {
  return new Date(value).getTime();
}

function latestByTimestamp(events) {
  return [...events].sort((left, right) => timestamp(left.timestamp) - timestamp(right.timestamp)).at(-1);
}

export function isTerminalRunState(state) {
  return terminalStates.has(state);
}

// This projection is deliberately derived only from durable JSONL events. The UI
// may cache it in the DOM, but it never becomes another source of runtime truth.
export function buildRunViewModels(events, { now = Date.now } = {}) {
  const runs = new Map();

  for (const event of events) {
    const runId = event.data?.runId;
    if (!runId) continue;
    const run = runs.get(runId) ?? { runId, events: [], toolResultIds: new Set() };
    run.events.push(event);
    runs.set(runId, run);
  }

  return [...runs.values()].map((run) => {
    const ordered = [...run.events].sort((left, right) => timestamp(left.timestamp) - timestamp(right.timestamp));
    const stateEvents = ordered.filter((event) => event.type === "run_state_changed");
    const latestStateEvent = latestByTimestamp(stateEvents);
    const finalEvent = latestByTimestamp(ordered.filter((event) => event.type === "agent_final" || event.type === "agent_error" || event.type === "agent_cancelled"));
    const orphanedEvent = latestByTimestamp(ordered.filter((event) => event.type === "supervisor_run_orphaned"));
    const latestState = orphanedEvent
      ? "orphaned"
      : latestStateEvent?.data?.to
      ?? "preparing";
    const toolResults = ordered.filter((event) => event.type === "tool_completed" || event.type === "tool_cancelled");
    for (const event of toolResults) run.toolResultIds.add(event.data?.toolCallId ?? event.id);
    const compactEvents = ordered.filter((event) => event.type === "context_compacted");
    const latestCompact = latestByTimestamp(compactEvents);
    const budgetWarning = latestByTimestamp(ordered.filter((event) => event.type === "run_budget_warning"));
    const budgetExceeded = latestByTimestamp(ordered.filter((event) => event.type === "run_budget_exceeded"));
    const startedAt = ordered[0]?.timestamp;
    const terminalEvent = latestByTimestamp([
      ...stateEvents.filter((event) => isTerminalRunState(event.data?.to)),
      ...(orphanedEvent ? [orphanedEvent] : [])
    ]);
    const endedAt = terminalEvent?.timestamp;
    const elapsedMs = startedAt ? Math.max(0, timestamp(endedAt ?? now()) - timestamp(startedAt)) : 0;

    return {
      runId: run.runId,
      events: ordered,
      state: latestState,
      isTerminal: isTerminalRunState(latestState),
      startedAt,
      endedAt,
      elapsedMs,
      turn: latestStateEvent?.data?.turn ?? 0,
      maxTurns: latestStateEvent?.data?.maxTurns ?? null,
      retries: latestStateEvent?.data?.retries ?? 0,
      maxRetries: latestStateEvent?.data?.maxRetries ?? null,
      deadlineMs: latestStateEvent?.data?.deadlineMs ?? null,
      remainingMs: latestStateEvent?.data?.remainingMs ?? null,
      analysisCount: stateEvents.filter((event) => event.data?.to === "sampling").length,
      toolResultCount: run.toolResultIds.size,
      compactCount: compactEvents.length,
      contextTokens: latestCompact?.data?.afterEstimatedTokens ?? latestCompact?.data?.beforeEstimatedTokens ?? null,
      budgetWarning: budgetWarning?.data ?? null,
      budgetExceeded: budgetExceeded?.data ?? null,
      terminalEventType: finalEvent?.type ?? terminalEvent?.type ?? null,
      terminalData: finalEvent?.data ?? terminalEvent?.data ?? null
    };
  });
}
