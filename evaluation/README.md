# 受控对比评测

本目录在同一个 `deepseek-v4-flash` Model 下，对 CodePilot 与 Claude CLI 执行刻意控制在较小范围内的对比。目标是发现具体 Harness Failure，而不是制造排行榜结论。

## 隔离 Contract

- 用例执行前，架构冻结在 `freeze-manifest.json` 记录的 Commit。
- 每个 Adapter / Case Pair 都获得新的 Synthetic Workspace；Validator Policy 禁止修改 Test File。
- CodePilot 使用新的 State Root 和 Session；Claude CLI 使用 `--bare --print --no-session-persistence`。
- 用例不包含生产仓库代码、用户内容或 Session 内容；Agent 只看到 Fixture 与 Task。
- 原始逐 Run 记录和 Workspace 保留在 Git Ignore 目录，只有标准化结果具备提交资格。
- Credential 由子进程继承，不写入 Command、Report、Stdout Summary 或 Artifact。

## 分数含义

只有测试通过、Mutation Behavior 符合要求、所有变更文件均在显式允许范围内时，用例才通过。只读用例还要求零文件修改和响应证据。Duration 只用于观察，不参与正确性判断。

```powershell
npm run eval:controlled
```

该对比规模不足以支持市场级 Coding Quality 结论。CodePilot 的差异化证据仍是 Project / Task 隔离、Run Lifecycle、Permission、JSONL Audit、Recovery 与可见 Delivery Receipt。
