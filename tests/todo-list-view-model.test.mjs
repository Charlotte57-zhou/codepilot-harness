import test from "node:test";
import assert from "node:assert/strict";
import { buildTodoListViewModel } from "../public/todo-list-view-model.js";

const todos = [
  { content: "Inspect", activeForm: "Inspecting", status: "completed" },
  { content: "Implement", activeForm: "Implementing", status: "in_progress" }
];

function completion(id, timestamp, { runId = "run-a", ok = true, nextTodos = todos } = {}) {
  return {
    id,
    type: ok ? "task_progress_changed" : "tool_completed",
    timestamp,
    data: ok ? {
      runId,
      version: 1,
      source: "codepilot_task",
      operation: "replace",
      tasks: nextTodos
    } : { runId, tool: "TaskUpdate", ok: false }
  };
}

test("todo projection uses the latest successful replacement in the selected run", () => {
  const first = todos.map((todo) => ({ ...todo, status: "pending" }));
  const view = buildTodoListViewModel([
    completion("2", "2026-07-20T10:00:02.000Z"),
    completion("1", "2026-07-20T10:00:01.000Z", { nextTodos: first }),
    completion("3", "2026-07-20T10:00:03.000Z", { runId: "run-b" })
  ], { runId: "run-a" });

  assert.equal(view.eventId, "2");
  assert.equal(view.completed, 1);
  assert.equal(view.activeIndex, 1);
  assert.equal(view.todos[1].activeForm, "Implementing");
  assert.deepEqual(view.todos.map(({ displayOrdinal }) => displayOrdinal), [1, 2]);
});

test("todo projection ignores failed updates and missing runs", () => {
  assert.equal(buildTodoListViewModel([
    completion("1", "2026-07-20T10:00:01.000Z", { ok: false })
  ], { runId: "run-a" }), null);
  assert.equal(buildTodoListViewModel([], { runId: "missing" }), null);
});

test("todo projection includes live structured file-change totals for the same run", () => {
  const fileChange = {
    path: "src/a.js",
    before: { exists: true, content: "old\nkeep" },
    after: { exists: true, content: "new\nkeep\nadded" }
  };
  const view = buildTodoListViewModel([
    completion("1", "2026-07-20T10:00:01.000Z"),
    {
      id: "2",
      type: "tool_completed",
      timestamp: "2026-07-20T10:00:02.000Z",
      data: { runId: "run-a", tool: "Edit", ok: true, metadata: { fileChange } }
    }
  ], { runId: "run-a" });

  assert.equal(view.changes.files.length, 1);
  assert.equal(view.changes.additions, 2);
  assert.equal(view.changes.deletions, 1);
});

test("todo projection replays normalized SDK task deltas including concurrent active tasks", () => {
  const fact = (id, sequence, data) => ({
    id, sequence, type: "task_progress_changed", timestamp: `2026-07-20T10:00:0${sequence}.000Z`,
    data: { runId: "run-sdk", version: 1, source: "claude_sdk_task", ...data }
  });
  const view = buildTodoListViewModel([
    fact("1", 1, { operation: "create", taskId: "1", patch: { id: "1", content: "实现 A", activeForm: "实现 A", status: "pending" } }),
    fact("2", 2, { operation: "create", taskId: "2", patch: { id: "2", content: "实现 B", activeForm: "实现 B", status: "pending" } }),
    fact("3", 3, { operation: "update", taskId: "1", patch: { status: "in_progress" } }),
    fact("4", 4, { operation: "update", taskId: "2", patch: { status: "in_progress" } })
  ], { runId: "run-sdk" });

  assert.deepEqual(view.activeIndexes, [0, 1]);
  assert.equal(view.primaryActiveIndex, 0);
  assert.equal(view.diagnostics.length, 0);
});

test("todo projection derives display ordinals independently from resumed SDK task ids", () => {
  const fact = (id, sequence, runId, data) => ({
    id, sequence, type: "task_progress_changed", timestamp: `2026-07-20T10:00:0${sequence}.000Z`,
    data: { runId, version: 1, source: "claude_sdk_task", ...data }
  });
  const view = buildTodoListViewModel([
    fact("old", 1, "old-run", { operation: "create", taskId: "3", patch: { id: "3", content: "旧任务" } }),
    fact("new-1", 2, "new-run", { operation: "create", taskId: "4", patch: { id: "4", content: "列出 tests" } }),
    fact("new-2", 3, "new-run", { operation: "create", taskId: "5", patch: { id: "5", content: "总结发现" } })
  ], { runId: "new-run" });

  assert.deepEqual(view.todos.map(({ id, displayOrdinal }) => [id, displayOrdinal]), [["4", 1], ["5", 2]]);
  assert.equal(view.total, 2);
});

test("todo projection ignores raw SDK task tool events outside the current fact contract", () => {
  const events = [
    { id: "r1", sequence: 1, type: "tool_requested", timestamp: "2026-07-20T10:00:01.000Z", data: { runId: "run-sdk", tool: "TaskCreate", toolCallId: "c1", input: { subject: "检查", activeForm: "检查中" } } },
    { id: "rr1", sequence: 2, type: "tool_result_recorded", timestamp: "2026-07-20T10:00:02.000Z", data: { runId: "run-sdk", tool: "TaskCreate", toolCallId: "c1", content: JSON.stringify({ content: "Task #1 created successfully: 检查" }) } },
    { id: "c1", sequence: 3, type: "tool_completed", timestamp: "2026-07-20T10:00:03.000Z", data: { runId: "run-sdk", tool: "TaskCreate", toolCallId: "c1", ok: true } },
    { id: "r2", sequence: 4, type: "tool_requested", timestamp: "2026-07-20T10:00:04.000Z", data: { runId: "run-sdk", tool: "TaskUpdate", toolCallId: "u1", input: { taskId: "1", status: "completed" } } },
    { id: "u1", sequence: 5, type: "tool_completed", timestamp: "2026-07-20T10:00:05.000Z", data: { runId: "run-sdk", tool: "TaskUpdate", toolCallId: "u1", ok: true } }
  ];
  const view = buildTodoListViewModel(events, { runId: "run-sdk" });
  assert.equal(view, null);
});
