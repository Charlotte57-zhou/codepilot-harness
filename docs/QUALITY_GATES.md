# 质量门禁

只有下列适用门禁都在干净公开导出目录中获得最新证据时，版本才具备发布资格。

## 必须通过的门禁

1. 使用 Node.js 22+，`npm ci` 能从 `package-lock.json` 完成安装。
2. `npm test` 通过全部 Root Tests。
3. `npm run check:context` 不报告失效 Canonical Link 或过期声明。
4. `npm run check:privacy` 对精确公开白名单扫描通过。
5. `npm run export:public` 创建干净目录，且 `npm run verify:public -- --input <DIR>` 验证每个 Manifest Hash。
6. 在导出目录中重复安装、测试、Context 和 Privacy Check。
7. `npm audit --audit-level=high` 不报告 High / Critical Finding。
8. `npm run package:win` 生成预期 Portable Executable，并记录 SHA-256 与未签名状态。
9. 从 Release Source 启动 Electron，在宽、窄窗口检查真实界面；走查 Project / Task 创建、一次 Permission Decision、Tool Trace、Diff / Undo、Cancellation / Resume、Settings、Error / Empty State。
10. 审查 Git Status 与最终公开仓库树；公开历史以一个干净 Release Commit 起步，且不包含私有 Workflow、Runtime State、Transcript 或 Hosted Deployment。

GitHub-hosted Windows Runner 不提供可用的用户 DPAPI PowerShell Module，因此 CI 跳过单个真实 DPAPI Switching Smoke，但仍运行 Vault Isolation / Concurrency 测试。Release Owner 必须在本地 Windows 用户 Session 中执行完整测试，且该 Smoke 必须通过。

## 测试覆盖的不变量

- 只有一个 SDK Agent Loop；
- 每个 Tool Call 恰好对应一个持久结果；
- 持久事件具有当前 WorkspaceTarget / Run / Batch 身份；
- Tool Result 顺序确定；
- Provider Key 不进入 Renderer / JSONL / Git；
- Workspace Path 在执行前完成校验；
- Resume 使用最新 Task 与冻结偏好；
- UI 终态源自显式 Run State Event；
- Public Exporter 基于 Allowlist，而不是 Ignore List。

## 证据边界

单元测试证明 Contract，不证明真实 Provider 可用性、OS Sandbox、生产规模或模型质量优劣。视觉截图证明已渲染状态，不等于完整无障碍验收。未签名 Binary 会触发 Windows Reputation Warning。
