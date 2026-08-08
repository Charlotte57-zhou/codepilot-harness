import test from "node:test";
import assert from "node:assert/strict";
import { selectCompletedSdkSession } from "../src/sdk-session-resume.mjs";

test("does not resume an SDK session from a cancelled or incomplete run", () => {
  const events = [
    { type: "claude_sdk_session_initialized", data: { runId: "run-1", provider: "moonshot", sdkSessionId: "sdk-stale" } },
    { type: "agent_cancelled", data: { runId: "run-1" } }
  ];
  assert.equal(selectCompletedSdkSession(events, "moonshot"), undefined);
});

test("resumes the newest SDK session whose run passed the completion gate", () => {
  const events = [
    { type: "claude_sdk_session_initialized", data: { runId: "run-1", provider: "moonshot", sdkSessionId: "sdk-good" } },
    { type: "agent_final", data: { runId: "run-1" } },
    { type: "claude_sdk_session_initialized", data: { runId: "run-2", provider: "moonshot", sdkSessionId: "sdk-incomplete" } }
  ];
  assert.equal(selectCompletedSdkSession(events, "moonshot"), "sdk-good");
});

test("does not cross provider ownership boundaries", () => {
  const events = [
    { type: "claude_sdk_session_initialized", data: { runId: "run-1", provider: "anthropic", sdkSessionId: "sdk-anthropic" } },
    { type: "agent_final", data: { runId: "run-1" } }
  ];
  assert.equal(selectCompletedSdkSession(events, "moonshot"), undefined);
});
