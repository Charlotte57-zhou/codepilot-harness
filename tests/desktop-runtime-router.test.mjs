import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

import { ProjectRuntimeCoordinator } from "../desktop/project-runtime-coordinator.mjs";
import { createDesktopRuntimeRouter, isWorkspacePreviewUrl } from "../desktop/runtime-router.mjs";

async function upstream(label) {
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    response.writeHead(request.url === "/missing" ? 404 : 201, {
      "content-type": "application/json",
      "x-runtime": label
    });
    response.end(JSON.stringify({ label, method: request.method, path: request.url, body: Buffer.concat(body).toString("utf8") }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, port: server.address().port };
}

test("desktop runtime router preserves one loopback origin while forwarding request and response contracts", async (context) => {
  const first = await upstream("first");
  const second = await upstream("second");
  const router = createDesktopRuntimeRouter({ upstreamPort: first.port });
  const origin = await router.listen();
  context.after(async () => Promise.all([
    router.close(),
    new Promise((resolve) => first.server.close(resolve)),
    new Promise((resolve) => second.server.close(resolve))
  ]));

  const before = await fetch(`${origin}/api/project?view=full`, { method: "POST", body: "fixture" });
  assert.equal(before.status, 201);
  assert.equal(before.headers.get("x-runtime"), "first");
  assert.deepEqual(await before.json(), { label: "first", method: "POST", path: "/api/project?view=full", body: "fixture" });

  router.swap(second.port);
  const after = await fetch(`${origin}/missing`);
  assert.equal(after.status, 404);
  assert.equal(after.headers.get("x-runtime"), "second");
  assert.equal((await after.json()).label, "second");
  assert.equal(new URL(origin).hostname, "localhost");
});

test("desktop runtime router fails closed when its active runtime is unavailable", async (context) => {
  const target = await upstream("gone");
  const router = createDesktopRuntimeRouter({ upstreamPort: target.port });
  const origin = await router.listen();
  await new Promise((resolve) => target.server.close(resolve));
  context.after(() => router.close());

  const response = await fetch(`${origin}/api/project`);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "CodePilot Runtime is unavailable" });
});

test("preview URLs are limited to the current exact loopback origin and preview route", () => {
  assert.equal(isWorkspacePreviewUrl("http://127.0.0.1:5123/preview/index.html", "http://127.0.0.1:5123"), true);
  assert.equal(isWorkspacePreviewUrl("http://127.0.0.1:5124/preview/index.html", "http://127.0.0.1:5123"), false);
  assert.equal(isWorkspacePreviewUrl("http://127.0.0.1:5123/api/project", "http://127.0.0.1:5123"), false);
  assert.equal(isWorkspacePreviewUrl("https://example.test/preview/index.html", "http://127.0.0.1:5123"), false);
});

const targetA = { id: "target-aaaaaaaaaaaaaaaa", kind: "main" };
const targetB = { id: "target-bbbbbbbbbbbbbbbb", kind: "main" };

function coordinatorFixture({ targetIdentity = "project-b", targetWorkspaceIdentity = targetB.id, running = false, selectFails = false, startFails = false, onInspect } = {}) {
  const projects = new Map([
    ["project-a", { id: "project-a" }],
    ["project-b", { id: "project-b" }]
  ]);
  const calls = [];
  const router = { port: 4100, swap(port) { this.port = port; calls.push(["swap", port]); } };
  const coordinator = new ProjectRuntimeCoordinator({
    currentProject: projects.get("project-a"),
    currentTarget: targetA,
    currentRuntime: { port: 4100, process: "old", previewOrigin: "http://127.0.0.1:5100" },
    router,
    resolveProject: (id) => projects.get(id),
    resolveTarget: async (project, intent) => {
      calls.push(["resolve", intent.sessionId ?? intent.newTask ?? null]);
      return project.id === "project-a" ? targetA : targetB;
    },
    inspectRuntime: async (runtime, inspectOptions) => {
      onInspect?.(runtime, inspectOptions);
      return runtime.process === "old"
        ? { id: "project-a", workspaceTargetId: targetA.id, running, previewOrigin: runtime.previewOrigin }
        : { id: targetIdentity, workspaceTargetId: targetWorkspaceIdentity, running: false, previewOrigin: "http://127.0.0.1:5200" };
    },
    startRuntime: async (_project, target) => {
      calls.push(["start", target.id]);
      if (startFails) throw new Error("startup failed");
      return { port: 4200, process: "new" };
    },
    stopRuntime: async (runtime) => calls.push(["stop", runtime.process]),
    selectProject: async (id, targetId) => {
      calls.push(["select", id, targetId]);
      if (selectFails) throw new Error("registry failed");
      return projects.get(id);
    }
  });
  return { coordinator, calls, router };
}

test("project runtime handoff commits a verified target while retaining the previous runtime warm", async () => {
  const { coordinator, calls, router } = coordinatorFixture();
  const receipt = await coordinator.switchProject("project-b", { sessionId: "session-fixture" });
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(receipt, { projectId: "project-b", workspaceTargetId: targetB.id, navigationIntent: { sessionId: "session-fixture" }, changed: true });
  assert.equal(coordinator.currentProject.id, "project-b");
  assert.equal(coordinator.currentTarget.id, targetB.id);
  assert.equal(coordinator.currentRuntime.previewOrigin, "http://127.0.0.1:5200");
  assert.equal(router.port, 4200);
  assert.deepEqual(calls, [
    ["resolve", "session-fixture"], ["start", targetB.id], ["swap", 4200], ["select", "project-b", targetB.id]
  ]);
});

test("project runtime handoff reuses a warm Project and Workspace Target", async () => {
  const { coordinator, calls, router } = coordinatorFixture();
  await coordinator.switchProject("project-b");
  calls.length = 0;

  const receipt = await coordinator.switchProject("project-a");

  assert.equal(receipt.changed, true);
  assert.equal(router.port, 4100);
  assert.deepEqual(calls, [
    ["resolve", null], ["swap", 4100], ["select", "project-a", targetA.id]
  ]);
});

test("project runtime warm-up shares the verified instance with the next switch", async () => {
  const { coordinator, calls } = coordinatorFixture();
  await coordinator.warmProject("project-b");
  await coordinator.switchProject("project-b");

  assert.equal(calls.filter(([name]) => name === "start").length, 1);
});

test("activating a warm runtime refreshes the application-owned model configuration", async () => {
  const inspections = [];
  const { coordinator } = coordinatorFixture({
    onInspect: (runtime, options) => inspections.push([runtime.process, options ?? null])
  });
  await coordinator.warmProject("project-b");
  inspections.length = 0;

  await coordinator.switchProject("project-b");

  assert.deepEqual(inspections, [
    ["old", null],
    ["new", { refreshModelConfig: true }]
  ]);
});

test("discarding a non-current Project drains its warm runtime", async () => {
  const { coordinator, calls } = coordinatorFixture();
  await coordinator.warmProject("project-b");
  calls.length = 0;

  await coordinator.discardProject("project-b");

  assert.deepEqual(calls, [["stop", "new"]]);
});

test("project runtime handoff preserves the old project for startup, identity, registry, and active-run failures", async () => {
  for (const options of [
    { startFails: true, message: /startup failed/ },
    { targetIdentity: "wrong-project", message: /identity mismatch/ },
    { targetWorkspaceIdentity: "target-cccccccccccccccc", message: /Workspace identity mismatch/ },
    { selectFails: true, message: /registry failed/ },
    { running: true, message: /正在运行/ }
  ]) {
    const { coordinator, router } = coordinatorFixture(options);
    await assert.rejects(coordinator.switchProject("project-b"), options.message);
    assert.equal(coordinator.currentProject.id, "project-a");
    assert.equal(coordinator.currentTarget.id, targetA.id);
    assert.equal(coordinator.currentRuntime.process, "old");
    assert.equal(router.port, 4100);
  }
});

test("project runtime handoff serializes rapid switch intents", async () => {
  const projects = new Map([
    ["project-a", { id: "project-a" }],
    ["project-b", { id: "project-b" }],
    ["project-c", { id: "project-c" }]
  ]);
  let nextPort = 4200;
  const starts = [];
  const coordinator = new ProjectRuntimeCoordinator({
    currentProject: projects.get("project-a"),
    currentTarget: targetA,
    currentRuntime: { port: 4100, process: "project-a" },
    router: { swap() {} },
    resolveProject: (id) => projects.get(id),
    resolveTarget: async (project) => ({ id: `target-${project.id.at(-1).repeat(16)}` }),
    inspectRuntime: async (runtime) => ({ id: runtime.process, workspaceTargetId: runtime.targetId ?? targetA.id, running: false, previewOrigin: "http://127.0.0.1:5000" }),
    startRuntime: async (project, target) => {
      starts.push(project.id);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return { port: nextPort++, process: project.id, targetId: target.id };
    },
    stopRuntime: async () => {},
    selectProject: async (id) => projects.get(id)
  });

  const first = coordinator.switchProject("project-b");
  const second = coordinator.switchProject("project-c");
  await Promise.all([first, second]);
  assert.deepEqual(starts, ["project-b", "project-c"]);
  assert.equal(coordinator.currentProject.id, "project-c");
});

test("project runtime handoff treats a Workspace Target change inside one Project as a runtime change", async () => {
  const project = { id: "project-a" };
  const worktree = { id: "target-cccccccccccccccc", kind: "worktree" };
  const starts = [];
  const coordinator = new ProjectRuntimeCoordinator({
    currentProject: project,
    currentTarget: targetA,
    currentRuntime: { port: 4100, process: "main", targetId: targetA.id },
    router: { swap() {} },
    resolveProject: () => project,
    resolveTarget: async (_project, intent) => intent.sessionId ? worktree : targetA,
    inspectRuntime: async (runtime) => ({
      id: project.id,
      workspaceTargetId: runtime.targetId,
      running: false,
      previewOrigin: "http://127.0.0.1:5000"
    }),
    startRuntime: async (_project, target) => {
      starts.push(target.id);
      return { port: 4200, process: "worktree", targetId: target.id };
    },
    stopRuntime: async () => {},
    selectProject: async () => project
  });

  const changed = await coordinator.switchProject(project.id, { sessionId: "worktree-session" });
  assert.equal(changed.changed, true);
  assert.equal(changed.workspaceTargetId, worktree.id);
  assert.deepEqual(starts, [worktree.id]);

  const unchanged = await coordinator.switchProject(project.id, { sessionId: "worktree-session" });
  assert.equal(unchanged.changed, false);
  assert.deepEqual(starts, [worktree.id]);
});
