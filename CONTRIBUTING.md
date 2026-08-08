# 贡献指南

感谢你参与 CodePilot。请优先提交边界清楚、可验证、能改善真实 Agent 交付工作流的变更。

## 开始前

1. 阅读 [产品定义](PRODUCT.md)、[系统架构](docs/ARCHITECTURE.md) 和 [质量门禁](docs/QUALITY_GATES.md)。
2. 对较大产品或架构变更先创建 Proposal Issue，说明用户问题、状态所有者、端到端链路、失败恢复与选项权衡。
3. 不添加兼容层、静默 Fallback、重复 Validator 或未经验证的抽象；v0.1 的 Contract 变化直接作为 Breaking Change 说明。

## 本地开发

```powershell
npm ci
npm test
npm run desktop
```

请从当前代码、调用方和测试确认命令及 Contract，不以文档摘要替代代码事实。

## Pull Request 要求

- 每个变更都能映射到具体用户问题或根因。
- 明确状态所有者，并沿 `UI -> Server -> Runtime / Tool / Model -> JSONL -> Projector -> UI` 检查数据流。
- 新行为具有聚焦测试；用户可见变更检查真实 Electron 窗口。
- 运行适用的 `npm test`、`npm run check:context`、`npm run check:privacy`。
- 不提交 Key、Token、Transcript、Runtime State、个人路径、私有源码、构建产物或无关改动。
- Breaking Change 说明新 Contract、影响、迁移决策与回滚方式，而不是新增兼容路径。

## 文档语言

面向用户和 GitHub 访客的文档以中文为主，代码标识、命令、协议名和必要术语保持原文。Apache-2.0 `LICENSE` 保留标准英文文本。

## Commit 与风格

保持修改聚焦，复用现有模块和测试模式。不要批量格式化、覆盖他人未提交工作或把生成的私有 Artifact 加入 Git。

## 行为准则与安全

参与即表示同意遵守 [行为准则](CODE_OF_CONDUCT.md)。安全问题请按 [安全策略](SECURITY.md) 私密报告。
