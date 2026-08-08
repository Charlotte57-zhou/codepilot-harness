import test from "node:test";
import assert from "node:assert/strict";

import {
  createPrimaryNavigation,
  derivePrimaryNavigation,
  setPrimaryView
} from "../public/primary-navigation.js";

test("Skills is the only current navigation target while the Skills page is open", () => {
  const navigation = setPrimaryView(createPrimaryNavigation(), "skills");
  assert.deepEqual(
    derivePrimaryNavigation(navigation, {
      currentSessionId: "session-1",
      candidateSessionId: "session-1"
    }),
    { skillsCurrent: true, mcpCurrent: false, sessionCurrent: false }
  );
});

test("closing Skills restores the selected conversation as the current navigation target", () => {
  const skills = setPrimaryView(createPrimaryNavigation(), "skills");
  const conversation = setPrimaryView(skills, "conversation");
  assert.deepEqual(
    derivePrimaryNavigation(conversation, {
      currentSessionId: "session-1",
      candidateSessionId: "session-1"
    }),
    { skillsCurrent: false, mcpCurrent: false, sessionCurrent: true }
  );
});

test("MCP is exclusive with Skills and the selected conversation", () => {
  const navigation = setPrimaryView(createPrimaryNavigation("skills"), "mcp");
  assert.deepEqual(
    derivePrimaryNavigation(navigation, {
      currentSessionId: "session-1",
      candidateSessionId: "session-1"
    }),
    { skillsCurrent: false, mcpCurrent: true, sessionCurrent: false }
  );
});

test("primary navigation rejects ambiguous view names", () => {
  assert.throws(() => setPrimaryView(createPrimaryNavigation(), "both"), /Unknown primary view/);
});
