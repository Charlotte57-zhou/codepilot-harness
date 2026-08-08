---
name: Harness Audit
description: 修改前审计一个小型需求，报告相关文件、约束与验证计划。
when_to_use: 在当前 Workspace 执行边界明确的演示修改前使用。
version: 1.0.0
allowed-tools: [Read, Glob, Grep]
context: inline
model-invocable: true
user-invocable: true
---

# Harness Audit

修改代码前：

1. 阅读 Workspace 中的 `AGENT.md` 和目标文件。
2. 找到拥有所请求行为的最小文件集合。
3. 给出一条可观察的验收标准和一条回滚操作。
4. 所有读取都限制在当前 Workspace 内。

输出简洁计划。后续 Edit、Test、Diff 与 Revert 仍由正常 Agent Loop 负责。
