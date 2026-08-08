import test from "node:test";
import assert from "node:assert/strict";
import { RunSupervisor } from "../src/run-supervisor.mjs";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("RunSupervisor serializes foreground runs per session", async () => {
  const events = [];
  const gates = [];
  const supervisor = new RunSupervisor({ appendEvent: async (sessionId, type, data) => events.push({ sessionId, type, data }) });
  const first = await supervisor.schedule({ sessionId: "s1", runId: "r1", execute: () => new Promise((resolve) => gates.push(() => resolve({ state: "completed", id: "r1" }))) });
  const second = await supervisor.schedule({ sessionId: "s1", runId: "r2", execute: () => new Promise((resolve) => gates.push(() => resolve({ state: "completed", id: "r2" }))) });

  assert.equal(first.snapshot().status, "running");
  assert.equal(second.snapshot().status, "queued");
  assert.equal(supervisor.hasAnyActive(), true);
  assert.deepEqual(events.map((event) => event.type), ["supervisor_run_started", "supervisor_run_queued"]);

  await tick();
  gates[0]();
  await first.promise;
  await tick();
  assert.equal(second.snapshot().status, "running");
  gates[1]();
  assert.equal((await second.promise).id, "r2");
  assert.equal(supervisor.hasAnyActive(), false);
  assert.deepEqual(events.filter((event) => event.type === "supervisor_run_started").map((event) => event.data.runId), ["r1", "r2"]);
});

test("a child run inherits cancellation without sharing parent context", async () => {
  const events = [];
  const parent = new AbortController();
  const supervisor = new RunSupervisor({ appendEvent: async (sessionId, type, data) => events.push({ sessionId, type, data }) });
  const child = await supervisor.schedule({
    sessionId: "sidechain-1",
    runId: "child-1",
    parentRunId: "parent-1",
    kind: "child",
    parentSignal: parent.signal,
    execute: async ({ signal }) => new Promise((resolve) => signal.addEventListener("abort", () => resolve({ state: "cancelled" }), { once: true }))
  });
  parent.abort({ reason: "parent_cancelled", code: "PARENT_CANCELLED" });
  const result = await child.promise;
  assert.equal(result.state, "cancelled");
  assert.equal(child.snapshot().status, "cancelled");
  assert.equal(events.find((event) => event.type === "supervisor_run_started").data.parentRunId, "parent-1");
});

test("orphan recovery records a terminal supervisor event", async () => {
  const appended = [];
  const supervisor = new RunSupervisor({ appendEvent: async (sessionId, type, data) => appended.push({ sessionId, type, data }) });
  const repaired = [];
  const orphaned = await supervisor.recoverOrphans(["s1"], async () => [
    { type: "supervisor_run_started", data: { runId: "r1", kind: "foreground" } },
    { type: "supervisor_run_started", data: { runId: "r2", kind: "background" } },
    { type: "supervisor_run_completed", data: { runId: "r2" } }
  ], async (run) => repaired.push(run));
  assert.deepEqual(orphaned, [{ sessionId: "s1", runId: "r1" }]);
  assert.equal(appended[0].type, "supervisor_run_orphaned");
  assert.equal(repaired[0].runId, "r1");
});
