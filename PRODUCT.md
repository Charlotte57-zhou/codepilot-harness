# CodePilot 产品定义

## 产品定位

CodePilot 是本地 Coding Agent 的交付控制平面。它把 SDK Agent Loop 放入一个可观察、可恢复、可审查和可撤销的工程工作流，让用户不仅看到模型回复，还能理解 Agent 在哪个目标上、以什么权限、完成了哪些真实操作。

## 用户问题

直接运行 Coding Agent 时，模型能力与工程交付之间仍存在断层：任务上下文容易混淆，工具行为缺少清晰证据，中断后的恢复语义不明确，Git 交付与模型对话分离，Secret 与执行边界也常被模糊表述。

## 核心 Job

> 当我把一个真实代码任务交给 Agent 时，我希望限定执行目标和权限，持续观察它的行为，在中断后恢复事实，并用 Diff、测试和 Git 结果决定接受、撤销或交付。

## 产品对象

- **Project** 负责仓库、默认分支和可选的 GitHub 连接。
- **Task** 负责用户目标、会话上下文和选定的 WorkspaceTarget，可使用隔离 Git Worktree。
- **Run** 负责一次执行尝试、冻结能力快照、权限决策、工具事件与终态。
- **JSONL** 负责持久事实；UI Projection 是可重建派生状态。

## v0.1 核心价值

1. **目标隔离：** Project、Task 与 WorkspaceTarget 让并行工作不互相污染。
2. **过程可见：** 用户能看到 Tool Call、Permission、Diff 和失败原因。
3. **失败可恢复：** 取消或进程中断不会把模型文本误当成 Run 终态。
4. **交付可逆：** Task 从隔离 Worktree 走向 Undo、Push 和 GitHub PR。
5. **能力可组合：** Skills / MCP 扩展能力，但不形成第二套 Agent Loop。

## 差异化

CodePilot 不以复制成熟 Coding Agent 的功能广度为目标。它聚焦“从 Agent 执行到可控交付”的中间层：状态所有权、审计证据、恢复路径与 Git 工作流是第一等产品能力，而不是聊天界面的附加按钮。

## 成功标准

陌生开发者可以在本地 Fixture 中完成一次 Task：观察工具和权限、检查 Diff、运行验证、撤销或交付，并能从 UI 和 JSONL 解释 Run 的最终结果。

## 非目标

Hosted 多租户平台、跨平台生产发行、完整 Provider 生态，以及与 Claude Code / Codex 的全面功能等价不属于 v0.1 范围。
