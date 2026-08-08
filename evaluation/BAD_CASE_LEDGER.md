# 受控评测 Bad Case 台账

## BC-001｜只读任务被完成门禁误判

- **Freeze / Model：** Product Commit `a1588bb`；两个 Adapter 均使用 `deepseek-v4-flash`。
- **观察结果：** 在有效的六用例评测中，CodePilot 为 5/6，Claude CLI 为 6/6。CodePilot 没有修改文件，Fixture Test 也通过，但 Completion Gate 反复要求 Mutation Evidence，最终 Run 以 `agent_error` 结束。
- **根因：** Mutation Classifier 命中了全局否定指令中的 “modify / create / delete” 等正向词，导致 `DeliveryContract` 为只读任务冻结了 `mutation.expected=true`。
- **责任归属：** `DeliveryContract` 负责 Task Acceptance Intent。`RunProgressLedger` 中重复的 Fallback Classifier 已删除；Ledger 现在消费同一 Canonical Classifier。
- **修复：** 全局中英文 No-write Intent 覆盖 Mutation Expectation；“修复源码但不要改测试”等局部约束仍归类为 Mutation Task。
- **验证：** 当时仓库回归为 243/243；修复后的目标对比中 CodePilot 与 Claude CLI 均为 1/1，且 CodePilot 修改文件数为零。额外分类器测试覆盖中文只读改写和英文局部修改约束。
- **剩余不确定性：** 修复后的完整六用例评测因 Provider Connection Incident 导致两个 Adapter 同时失败，因此未计入分数。修复前 CodePilot 通过的五个用例与完整仓库回归只作为非回归证据，不表述为修复后 6/6。
- **产品意义：** 这是 Harness 的完成条件假阴性，不是模型能力不足或越权修改。修复应属于冻结的 Acceptance Contract，而不是追加一句 Prompt。
