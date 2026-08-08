import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionBroker } from "../src/execution-broker.mjs";

test("ExecutionBroker records a process lifecycle around one execution identity", async () => {
  const events = [];
  const broker = new ExecutionBroker({
    appendEvent: async (sessionId, type, data) => events.push({ sessionId, type, data }),
    createId: () => "execution-a"
  });

  const result = await broker.execute({
    sessionId: "session-a",
    runId: "run-a",
    toolCallId: "tool-a",
    kind: "bash",
    metadata: { cwd: "." },
    execute: async ({ onSpawn }) => {
      await onSpawn({ pid: 1234, cancel: async () => {} });
      return { ok: true, content: "done", metadata: { execution: { exitCode: 0, durationMs: 5 } } };
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(events.map((event) => event.type), [
    "execution_requested",
    "execution_started",
    "execution_completed"
  ]);
  assert.equal(broker.snapshot("execution-a").status, "completed");
  assert.equal(broker.snapshot("execution-a").pid, 1234);
});

test("ExecutionBroker cancellation reaches the live process and records a terminal event", async () => {
  const events = [];
  let processCancelled = false;
  const broker = new ExecutionBroker({
    appendEvent: async (sessionId, type, data) => events.push({ sessionId, type, data }),
    createId: () => "execution-b"
  });

  const resultPromise = broker.execute({
    sessionId: "session-b",
    runId: "run-b",
    toolCallId: "tool-b",
    execute: async ({ signal, onSpawn }) => {
      await onSpawn({ pid: 5678, cancel: async () => { processCancelled = true; } });
      return new Promise((resolve) => {
        const cancelled = () => resolve({
          ok: false,
          error: { code: "TOOL_CANCELLED", message: "cancelled", details: { execution: { cancelled: true } } }
        });
        if (signal.aborted) cancelled();
        else signal.addEventListener("abort", cancelled, { once: true });
      });
    }
  });

  while (broker.snapshot("execution-b")?.status !== "running") {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(await broker.cancelExecution("execution-b"), true);
  await resultPromise;

  assert.equal(processCancelled, true);
  assert.equal(broker.snapshot("execution-b").status, "cancelled");
  assert.equal(events.at(-1).type, "execution_cancelled");
});

test("ExecutionBroker marks non-terminal persisted executions lost on restart", async () => {
  const appended = [];
  const broker = new ExecutionBroker({
    appendEvent: async (sessionId, type, data) => appended.push({ sessionId, type, data })
  });
  const recovered = await broker.recoverOrphans(["session-c"], async () => [
    { type: "execution_started", data: { executionId: "execution-c", runId: "run-c", toolCallId: "tool-c", pid: 99 } }
  ]);

  assert.deepEqual(recovered, [{ sessionId: "session-c", executionId: "execution-c" }]);
  assert.equal(appended[0].type, "execution_lost");
  assert.equal(appended[0].data.previousPid, 99);
});
