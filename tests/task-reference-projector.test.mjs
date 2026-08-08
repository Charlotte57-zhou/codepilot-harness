import test from "node:test";
import assert from "node:assert/strict";
import { projectTaskProgressReferences } from "../public/task-reference-projector.js";

const todo = {
  total: 2,
  todos: [
    { id: "4", displayOrdinal: 1 },
    { id: "5", displayOrdinal: 2 }
  ]
};

test("task reference projector maps session task identities to run-local ordinals", () => {
  assert.equal(
    projectTaskProgressReferences("✅ 任务 4/5 完成\n**任务 5/5：总结**", todo),
    "✅ 任务 1/2 完成\n**任务 2/2：总结**"
  );
  assert.equal(
    projectTaskProgressReferences("Task #4/5 done; Task 5/5 next", todo),
    "Task #1/2 done; Task 2/2 next"
  );
  assert.equal(
    projectTaskProgressReferences([
      "| # | 任务 | 状态 |",
      "|---|------|------|",
      "| 4 | 列出 tests | 完成 |",
      "| 5 | 总结 | 完成 |"
    ].join("\n"), todo),
    [
      "| # | 任务 | 状态 |",
      "|---|------|------|",
      "| 1 | 列出 tests | 完成 |",
      "| 2 | 总结 | 完成 |"
    ].join("\n")
  );
});

test("task reference projector preserves unknown task references and unrelated numbers", () => {
  const source = "任务 3/5 不属于本轮；测试 4/5 通过；src/4/5.js";
  assert.equal(projectTaskProgressReferences(source, todo), source);
  assert.equal(projectTaskProgressReferences(source, null), source);
  assert.equal(
    projectTaskProgressReferences("| # | 测试 |\n|---|---|\n| 4 | 通过 |", todo),
    "| # | 测试 |\n|---|---|\n| 4 | 通过 |"
  );
});
