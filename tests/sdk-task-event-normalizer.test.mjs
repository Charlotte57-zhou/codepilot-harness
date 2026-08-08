import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSdkTaskResult } from "../src/sdk-task-event-normalizer.mjs";

test("SDK TaskCreate becomes a stable product task fact", () => {
  const fact = normalizeSdkTaskResult({
    call: { id: "call-1", name: "TaskCreate", input: { subject: "检查项目", activeForm: "检查项目中" } },
    resultContent: "Task #7 created successfully: 检查项目",
    runId: "run-1"
  });
  assert.equal(fact.operation, "create");
  assert.equal(fact.taskId, "7");
  assert.deepEqual(fact.patch, {
    id: "7", content: "检查项目", activeForm: "检查项目中", status: "pending", blockedBy: []
  });
});

test("SDK TaskUpdate preserves the task id and supported patch fields", () => {
  const fact = normalizeSdkTaskResult({
    call: { id: "call-2", name: "TaskUpdate", input: { taskId: "7", status: "in_progress" } },
    resultContent: "Updated task #7 status",
    runId: "run-1"
  });
  assert.deepEqual(fact.patch, { status: "in_progress" });
  assert.equal(fact.taskId, "7");
});

test("SDK TaskList accepts structured snapshots and diagnoses unknown output", () => {
  const snapshot = normalizeSdkTaskResult({
    call: { id: "call-3", name: "TaskList", input: {} },
    resultContent: JSON.stringify({ tasks: [{ id: "1", subject: "实现", status: "completed" }] }),
    runId: "run-1"
  });
  assert.equal(snapshot.operation, "snapshot");
  assert.equal(snapshot.tasks[0].status, "completed");

  const diagnostic = normalizeSdkTaskResult({
    call: { id: "call-4", name: "TaskList", input: {} },
    resultContent: "No structured task data",
    runId: "run-1"
  });
  assert.equal(diagnostic.operation, "diagnostic");
  assert.equal(diagnostic.diagnostic.code, "SDK_TASK_LIST_UNRECOGNIZED");
});
