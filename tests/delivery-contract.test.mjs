import test from "node:test";
import assert from "node:assert/strict";
import { createDeliveryContract } from "../src/delivery-contract.mjs";

test("DeliveryContract freezes an interactive web acceptance protocol", () => {
  const contract = createDeliveryContract({
    task: "创建 games/plane-war/index.html 飞机大战游戏",
    capabilities: { input: { image: true } },
    browserToolsAvailable: true
  });
  assert.equal(contract.artifact.kind, "interactive_web");
  assert.equal(contract.artifact.entryHint, "games/plane-war/index.html");
  assert.equal(contract.verification.requireInteraction, true);
  assert.equal(contract.verification.providerVision, "required");
  assert.equal(Object.isFrozen(contract.verification), true);
});

test("DeliveryContract degrades explicitly when browser or vision capability is absent", () => {
  const contract = createDeliveryContract({ task: "创建 index.html 网页", capabilities: { input: { image: false } }, browserToolsAvailable: false });
  assert.equal(contract.verification.mode, "tool_evidence");
  assert.equal(contract.verification.providerVision, "not_available");
});

test("DeliveryContract treats global no-write instructions as read-only without weakening scoped mutation tasks", () => {
  const readOnly = createDeliveryContract({
    task: "只读检查项目并总结测试；不要修改、创建或删除任何文件。"
  });
  const scopedMutation = createDeliveryContract({
    task: "修复 src/page-size.mjs，但不要修改测试。"
  });
  const englishReadOnly = createDeliveryContract({
    task: "Review the code and do not modify any files."
  });
  const paraphrasedReadOnly = createDeliveryContract({
    task: "分析模块边界并报告，不得变更工作区代码。"
  });
  const englishScopedMutation = createDeliveryContract({
    task: "Fix src/page-size.mjs without changing test files."
  });
  assert.equal(readOnly.mutation.expected, false);
  assert.equal(englishReadOnly.mutation.expected, false);
  assert.equal(paraphrasedReadOnly.mutation.expected, false);
  assert.equal(scopedMutation.mutation.expected, true);
  assert.equal(englishScopedMutation.mutation.expected, true);
});
