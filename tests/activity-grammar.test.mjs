import test from "node:test";
import assert from "node:assert/strict";
import { summarizeActivityOperations } from "../public/activity-grammar.js";

const operation = (semanticKey, family, status = "completed", subject = "") => ({
  semanticKey,
  family,
  status,
  subject: { primary: subject }
});

test("grammar folds read list and search into one exploration clause", () => {
  const summary = summarizeActivityOperations([
    operation("exploration.read", "exploration"),
    operation("exploration.list", "exploration"),
    operation("exploration.search", "exploration")
  ]);
  assert.equal(summary.label, "检查了 3 项代码");
});

test("grammar keeps first category order and appends failure truth", () => {
  const summary = summarizeActivityOperations([
    operation("file.edit", "file", "completed", "src/app.js"),
    operation("command.run", "command"),
    operation("command.run", "command", "failed"),
    operation("browser.inspect", "browser")
  ]);
  assert.equal(summary.label, "编辑了 app.js、运行了 2 个命令并检查了界面，其中 1 项失败");
});

test("grammar omits bookkeeping and renders running, cancellation and English deterministically", () => {
  const running = summarizeActivityOperations([
    operation("task.update", "task"),
    operation("command.run", "command", "running")
  ]);
  assert.equal(running.label, "正在运行命令");
  const cancelled = summarizeActivityOperations([
    operation("command.run", "command", "cancelled")
  ]);
  assert.equal(cancelled.label, "运行了命令，其中 1 项已取消");
  assert.equal(summarizeActivityOperations([
    operation("exploration.read", "exploration"),
    operation("exploration.search", "exploration")
  ], { locale: "en" }).label, "Explored 2 items");
});

