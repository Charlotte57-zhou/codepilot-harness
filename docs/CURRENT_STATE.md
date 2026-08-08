# 当前状态

## 发布决策

CodePilot v0.1.0 定位为仅本地运行、Windows 优先的开源面试项目。公开版本不包含托管面试站点。当前 Schema 直接作为 Breaking Contract；不迁移预发布阶段的本地状态。

## 已验证实现范围

- Claude Agent SDK 是唯一 Agent Loop。
- Project / Task / Run、当前 WorkspaceTarget 身份、JSONL 事实源、投影、取消、修复和恢复均已实现。
- SDK 文件系统参数会在权限执行前校验，确保路径位于当前 Workspace 内。
- Electron 覆盖 Project / 最近 Task、隔离 Git Worktree、Diff / Undo、GitHub CLI 交付、Archive / Activity、Theme、Skills / MCP 与 Provider Vault 设置。
- 公开 Provider Profile 为 Anthropic、DeepSeek 和 Moonshot；`fake` 仅供内部测试。
- 公开导出器采用显式白名单、隐私扫描和逐文件 Manifest Hash 验证。
- GitHub 首页与公开文档以中文为主，并提供 4 张经过隐私检查的真实 Electron 产品截图。

## 已知边界

Windows 构建尚未签名；Bash 没有 OS Sandbox；Loopback 使用同一用户信任模型；暂无跨平台发布证据；干净公开版本未执行真实 Provider Credential Smoke；Skills、MCP 和 Recovery 深度仍小于成熟 Coding Agent。

## 后续优先级

构建签名与来源证明、真实 Provider Smoke 证据、无障碍与窄窗口强化、Transcript 导出与脱敏，以及更强进程隔离研究。
