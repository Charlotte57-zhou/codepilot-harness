# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 的组织方式。

## [0.1.0] - 2026-08-08

### 新增

- 基于 Claude Agent SDK 单一 Agent Loop 的本地 Electron Harness。
- Project / Task / Run、隔离 Git Worktree、JSONL 审计、恢复、Diff / Undo 与 GitHub CLI 交付。
- Server / Windows DPAPI Credential Vault、Permission、Skills / MCP 与 Provider Profile。
- Allowlist Public Export、Privacy Scan、Manifest Verification 与 Windows Portable Package。
- 中文优先的 GitHub 文档与经过隐私检查的真实产品截图。

### Breaking Change

- v0.1 只接受当前 Registry、WorkspaceTarget、Run 与 Event Contract，不迁移预发布本地状态，也不保留 Legacy Fallback。

### 已知限制

- Windows 优先，公开 Executable 未签名；Bash 不具备 OS Sandbox；未提交真实 Provider Credential Smoke 证据。
