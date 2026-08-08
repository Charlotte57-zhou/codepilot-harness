import test from "node:test";
import assert from "node:assert/strict";
import { isWorkspaceTargetId, workspaceTargetIdPattern } from "../src/workspace-target-identity.mjs";

test("Workspace Target identity accepts only the canonical bounded format", () => {
  assert.equal(isWorkspaceTargetId("target-0123456789abcdef"), true);
  assert.equal(isWorkspaceTargetId("target-0123456789ABCDEf"), false);
  assert.equal(isWorkspaceTargetId("target-short"), false);
  assert.equal(isWorkspaceTargetId(null), false);
  assert.match("target-fedcba9876543210", workspaceTargetIdPattern);
});
