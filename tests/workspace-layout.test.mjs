import test from "node:test";
import assert from "node:assert/strict";
import {
  createInspectorLayout,
  setInspectorOpen,
  toggleInspector,
  transitionInspectorViewport
} from "../public/workspace-layout.js";

test("wide workspaces start with the inspector closed so the conversation owns focus", () => {
  assert.deepEqual(createInspectorLayout(false), { compact: false, open: false });
});

test("compact workspaces start with the inspector closed", () => {
  assert.deepEqual(createInspectorLayout(true), { compact: true, open: false });
});

test("user toggles remain stable while the viewport mode is unchanged", () => {
  const opened = toggleInspector(createInspectorLayout(true));
  assert.deepEqual(transitionInspectorViewport(opened, true), { compact: true, open: true });
});

test("viewport transitions preserve an explicit inspector choice", () => {
  const opened = toggleInspector(createInspectorLayout(false));
  const compact = transitionInspectorViewport(opened, true);
  assert.deepEqual(compact, { compact: true, open: true });
  assert.deepEqual(transitionInspectorViewport(compact, false), { compact: false, open: true });
});

test("setting the existing state preserves object identity", () => {
  const layout = createInspectorLayout(false);
  assert.equal(setInspectorOpen(layout, false), layout);
});
