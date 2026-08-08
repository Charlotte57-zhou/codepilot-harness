# CodePilot 设计原则

## 设计目标

围绕 Claude Agent SDK 的单一 Agent Loop，CodePilot 通过高密度、克制的桌面工作台呈现任务上下文、运行行为、交付证据和恢复状态，同时避免用视觉效果掩盖执行失败。

## 交互原则

1. **Task 优先于 Chat：** 顶层信息结构是 Project、Target、Task 和 Run，而不是一串无归属消息。
2. **事实优先于叙述：** Tool Result、Permission、Test、Diff 与 Terminal State 和模型正文分层展示。
3. **高风险动作显式：** 用户在批准前看到 Capability、Path、Command 与后果。
4. **失败状态可行动：** Error、Cancel、Resume、Retry 和 Recovery 都给出当前状态与下一步。
5. **交付闭环：** Worktree、Diff、Undo、Push 与 PR 不离开当前 Task 上下文。

## 状态与数据设计

### Append-only JSONL

JSONL 是会话事实源。Projector 从事件重建 Task / Run UI；Snapshot 仅用于加速，不替代事实。v0.1 不从旧字段猜测当前 WorkspaceTarget、Run ID 或终态。

### Loopback Server + Electron

Renderer 只消费 DTO，不持有 Provider Secret 或 Runtime 权威状态。Server 组合 Runtime、Session、Git 与 Vault。Loopback 假设同一 OS 用户，Server 仍对请求字段和路径执行校验。

### SDK Built-ins + CodePilot Policy

SDK 负责模型迭代；CodePilot 负责 Workspace 路径、Run 身份、权限、持久化和投影。Bash 审批不是 Sandbox，界面必须明确这一点。

### Current Schema Breaking Change

v0.1 直接收敛到当前 Schema：Registry、WorkspaceTarget、Run ID 和恢复 Contract 缺失时明确失败，不增加兼容层或静默回退。

## 信息架构

左侧 Project 与最近 Task → 中央任务对话与 Agent Activity → 右侧 Context / Review Diff → 顶部 Workspace 与 Run 状态 → 设置中的 Provider / Permission / Skills / MCP。

## 视觉与无障碍

界面使用统一 Design Token、明确焦点态、稳定滚动和适合代码审查的信息密度。动效只表达状态变化，优先 `transform` / `opacity`，并遵守 `prefers-reduced-motion`。宽、窄窗口都必须保留任务与审查主路径。
