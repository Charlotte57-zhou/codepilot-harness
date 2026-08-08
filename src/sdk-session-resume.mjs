/**
 * Selects a Claude SDK session that reached CodePilot's completed state.
 *
 * An SDK init event alone is not resumable evidence: the corresponding run may
 * have been cancelled while the provider was sampling, leaving Claude Code's
 * transcript with an incomplete turn. Resuming that transcript can wait on the
 * abandoned turn forever (especially when a protocol adapter is involved).
 */
export function selectCompletedSdkSession(events = [], providerId = "anthropic") {
  const completedRunIds = new Set(events
    .filter((event) => event.type === "agent_final" && event.data?.runId)
    .map((event) => event.data.runId));

  return [...events].reverse().find((event) => {
    if (event.type !== "claude_sdk_session_initialized") return false;
    const eventProvider = event.data?.provider ?? "anthropic";
    return eventProvider === providerId
      && completedRunIds.has(event.data?.runId)
      && Boolean(event.data?.sdkSessionId);
  })?.data?.sdkSessionId;
}
