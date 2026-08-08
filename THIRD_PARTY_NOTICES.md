# 第三方声明

CodePilot 使用 `package-lock.json` 中记录的开源依赖。发布前应以锁定版本运行依赖许可证扫描，并根据各依赖要求保留其 License 与 Notice。

## 主要运行时依赖

- Electron
- Claude Agent SDK
- Express
- Zod
- MCP SDK
- Octokit

具体版本与 Transitive Dependency 以 `package-lock.json` 为准。

## Claude Code / Codex 参考边界

CodePilot 参考公开文档、公开源码映射和可观察产品行为来理解 Coding Agent 的职责边界、状态不变量与交互模式。CodePilot 不分发非公开专有源码，不复制品牌素材，也不宣称与 Claude Code 或 Codex 完全一致。控制平面基于公开 SDK Contract 与本项目需求独立实现。

第三方名称和商标归各自权利人所有，仅用于说明兼容性、依赖或比较边界，不代表背书。
