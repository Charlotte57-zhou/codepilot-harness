import { appendEvent, getEvents } from "./session-store.mjs";
import { projectTranscript, validateTranscript } from "./transcript-projector.mjs";

function cancelledToolResult(toolCall) {
  return JSON.stringify({
    ok: false,
    error: {
      code: "TOOL_CANCELLED",
      message: "Tool result was missing during session recovery",
      details: { reason: "transcript_repair", executionStarted: "unknown", sideEffect: "unknown" }
    },
    metadata: { recovered: true, tool: toolCall.name }
  });
}

/** Rebuilds from JSONL and repairs only the safe, protocol-required gap. */
export async function recoverSessionTranscript(sessionId) {
  let events = await getEvents(sessionId);
  let projection = projectTranscript(events);
  let validation = validateTranscript(projection);

  if (validation.repairable) {
    for (const toolCall of validation.missingToolResults) {
      const sourceEvent = [...events].reverse().find((event) => event.data?.toolCallId === toolCall.id && event.data?.runId);
      await appendEvent(sessionId, "tool_result_repaired", {
        tool: toolCall.name,
        toolCallId: toolCall.id,
        content: cancelledToolResult(toolCall),
        reason: "transcript_repair",
        runId: sourceEvent.data.runId
      });
    }
    events = await getEvents(sessionId);
    projection = projectTranscript(events);
    validation = validateTranscript(projection);
  }

  return { events, projection, validation };
}
