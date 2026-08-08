import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkspacePreviewServer, previewContentSecurityPolicy, workspacePreviewUrl } from "../src/workspace-preview-server.mjs";

test("workspace preview serves the exact workspace artifact on an isolated origin", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-preview-"));
  await mkdir(join(root, "game"));
  await writeFile(join(root, "game", "index.html"), "<!doctype html><title>Plane War</title>");
  const preview = createWorkspacePreviewServer({ workspaceRoot: root });
  const origin = await preview.listen();
  context.after(() => preview.close());

  const response = await fetch(workspacePreviewUrl(origin, "game/index.html"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/html/);
  assert.equal(response.headers.get("content-security-policy"), previewContentSecurityPolicy);
  assert.equal(await response.text(), "<!doctype html><title>Plane War</title>");
});

test("workspace preview keeps traversal and missing targets outside the preview surface", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "codepilot-preview-"));
  const preview = createWorkspacePreviewServer({ workspaceRoot: root });
  const origin = await preview.listen();
  context.after(() => preview.close());

  assert.equal((await fetch(`${origin}/preview/..%2Foutside.html`)).status, 403);
  assert.equal((await fetch(`${origin}/preview/missing.html`)).status, 404);
});

test("desktop binds the preview server port and only externalizes its preview route", async () => {
  const main = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"));
  const preload = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8"));
  assert.match(main, /CODEPILOT_PREVIEW_PORT/);
  assert.match(main, /isWorkspacePreviewUrl\(url, runtimeCoordinator\?\.currentRuntime\.previewOrigin\)/);
  assert.match(main, /startHarness\(port, 0, project, target, controlToken\)/);
  assert.match(main, /CODEPILOT_RUNTIME_CONTROL_TOKEN: controlToken/);
  assert.doesNotMatch(preload, /openWorkspaceArtifact/);
});
