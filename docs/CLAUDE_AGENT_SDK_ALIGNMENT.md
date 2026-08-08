# Claude Agent SDK 与成熟 Coding Agent 对齐情况

## 对齐判断

| 能力 | 判断 | 证据与边界 |
| --- | --- | --- |
| 单一 SDK Agent Loop | 已对齐 | `ClaudeAgentRuntime` 将迭代交给 SDK Query |
| Streaming Tool / Model Event | 已对齐 | Run 级标准化 JSONL 与 SSE Projection |
| Permission Hook | 已对齐 | SDK `canUseTool` + CodePilot Policy / Event |
| Workspace 文件系统守卫 | 部分对齐 | Canonical Path / Symlink 校验；没有 OS Sandbox |
| 持久 Session / Resume | 部分对齐 | 本地 JSONL Recovery 与新 Run Resume；未达到生态级能力 |
| Skills | 部分对齐 | 当前目录格式 Catalog 与冻结能力快照 |
| MCP | 部分对齐 | Curated / Local Connection 与 Tool Visibility；生命周期覆盖较窄 |
| Subagent | 未对齐 | v0.1 不宣称支持 |
| Hook / 生态广度 | 未对齐 | 不在 v0.1 范围内 |
| Git Worktree / Diff / Undo | 与 CodePilot 产品范围已对齐 | 本地交付工作流，不作为 SDK 能力等价声明 |
| 跨平台隔离 | 未对齐 | Windows 优先、本地受信用户边界 |

CodePilot 不复刻 Claude Code 或 Codex 的内部实现与品牌界面。公开行为和文档用于界定产品问题；CodePilot 的控制平面基于公开 SDK Contract 独立实现。
