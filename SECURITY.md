# 安全策略

## 支持范围

当前仅支持最新 `0.1.x` Release Branch。预发布 Snapshot 和 Fork 不在维护承诺内。

## 私密报告问题

请通过 GitHub Repository 的 **Security → Report a vulnerability** 提交 Private Security Advisory。报告中请包含：

- 受影响版本与 Windows / Node.js 环境；
- 最小复现步骤和影响；
- 已脱敏的 Event Type、Stack Trace 或 Screenshot；
- 你认为适用的缓解方式。

请勿在公开 Issue 中提交 Provider Key、Access Token、完整 Transcript、私有源码、用户名、组织名或本机绝对路径。

## 响应原则

维护者会先确认接收与可复现性，再说明影响范围、修复计划和披露时间。修复发布前，请保留问题细节的私密性。

## 当前安全边界

- Provider Key 由 Server 侧 Vault 保存，不返回 Renderer，不写入 JSONL 或 Git。
- SDK 文件工具在权限执行前验证 Workspace Root、绝对路径、目录穿越与 Symlink Escape。
- Loopback API 使用同一用户信任模型，不是远程多租户服务。
- Bash Permission 提供审批与审计，不构成 OS Sandbox；子进程仍拥有当前用户权限。
- JSONL 可能包含 Prompt 与源码片段，应作为敏感本地数据保护。

更多信息见 [Bash 安全边界](docs/bash-security-boundary.md) 与 [系统架构](docs/ARCHITECTURE.md)。
