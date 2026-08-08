import test from "node:test";
import assert from "node:assert/strict";
import { buildLineDiff, buildRunChangeSet, compactDiffRows, fileReviewMeta, previewArtifactForFile } from "../public/file-change-view-model.js";

test("preview artifacts bind an HTML mutation to the server-owned preview origin", () => {
  assert.deepEqual(previewArtifactForFile({
    path: "games/plane-war/index.html",
    after: { content: "<title>飞机大战</title>" }
  }, "http://127.0.0.1:4321"), {
    path: "games/plane-war/index.html",
    href: "http://127.0.0.1:4321/preview/games/plane-war/index.html",
    label: "飞机大战 · index.html"
  });
  assert.equal(previewArtifactForFile({ path: "src/main.js" }, "http://127.0.0.1:4321"), null);
  assert.equal(previewArtifactForFile({ path: "index.html" }, ""), null);
});

test("line diff keeps context and reports replacements", () => {
  const rows = buildLineDiff("a\nold\nz", "a\nnew\nz");
  assert.deepEqual(rows.map(({ kind }) => kind), ["context", "deletion", "addition", "context"]);
});

test("change set merges repeated edits by run and path", () => {
  const change = (before, after) => ({ path: "a.txt", before: { exists: true, content: before }, after: { exists: true, content: after } });
  const events = [
    { type: "tool_completed", data: { runId: "r", ok: true, metadata: { fileChange: change("a", "b") } } },
    { type: "tool_completed", data: { runId: "r", ok: true, metadata: { fileChange: change("b", "c") } } }
  ];
  const set = buildRunChangeSet(events, "r");
  assert.equal(set.files.length, 1);
  assert.equal(set.files[0].before.content, "a");
  assert.equal(set.files[0].after.content, "c");
  assert.equal(set.additions, 1);
  assert.equal(set.deletions, 1);
});

test("compact diff inserts one omitted marker per context gap", () => {
  const rows = buildLineDiff("a\nb\nc\nd\ne\nf\ng", "a\nb\nc\nD\ne\nf\ng");
  const compact = compactDiffRows(rows, 1);
  assert.equal(compact.filter(({ kind }) => kind === "omitted").length, 2);
  assert.deepEqual(compact.filter(({ kind }) => kind === "omitted").map(({ count, beforeStart, beforeEnd }) => ({ count, beforeStart, beforeEnd })), [
    { count: 2, beforeStart: 1, beforeEnd: 2 },
    { count: 2, beforeStart: 6, beforeEnd: 7 }
  ]);
});

test("review metadata separates paths and derives file status without reading Git", () => {
  assert.deepEqual(fileReviewMeta({
    path: "src\\agent\\runtime.mjs",
    before: { exists: true },
    after: { exists: true }
  }), { path: "src/agent/runtime.mjs", name: "runtime.mjs", directory: "src/agent", status: "modified" });
  assert.equal(fileReviewMeta({ path: "new.txt", before: { exists: false }, after: { exists: true } }).status, "added");
  assert.equal(fileReviewMeta({ path: "old.txt", before: { exists: true }, after: { exists: false } }).status, "deleted");
});
