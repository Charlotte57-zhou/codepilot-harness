# CodePilot 十分钟面试演示

## 演示准备

主流程使用仓库自带的 Demo Repository 和确定性 `fake` Runtime，保证重复演示稳定。真实 Provider 只作为可选附录，不作为核心证明的依赖。

## 0:00–1:00｜用户问题与对象模型

开场说明：“CodePilot 是围绕单一 SDK Agent Loop 构建的本地控制平面。Project 管理仓库，Task 管理目标和 Worktree，Run 表示一次执行尝试，JSONL 保存持久事实。”随后展示 Project / Task / Run 层级。

## 1:00–3:00｜隔离任务

在隔离 Worktree 中创建 Task，输入：“审计 Fixture 的认证流程，解释风险，然后增加一个聚焦回归测试并做最小修复。”展示选中的 WorkspaceTarget 与干净 Baseline。

## 3:00–5:30｜可观察的 Agent 行为

打开 Run Trace，指出冻结的 Provider、Permission Mode、Skill Snapshot，以及 Read / Glob / Grep 调用和内置 `harness-audit` Skill。当写文件或 Shell 操作请求许可时，先解释能力、Workspace Path 和后果，再批准。

## 5:30–7:00｜结果与审查

展示修改文件、显式 Tool Result、测试结果和 Git Diff。明确区分模型叙述与执行证据。说明路径校验先于 Permission Execution，Bash Permission 不等于 OS Sandbox。

## 7:00–8:00｜可逆交付

执行 Undo，确认 Diff 回到 Baseline；如有需要再重跑。这证明产品控制的是交付过程，而不只是生成一段成功叙述。

## 8:00–9:00｜中断与恢复

在 Tool Call 后取消或停止 Run，再执行 Resume。展示系统使用最新 Task 和上次冻结偏好创建新 Run ID；打开事件详情，确认 Tool Result / Repair 成对以及显式终态。

## 9:00–10:00｜架构与边界

串讲 Renderer → Loopback Server → Runtime → SDK Tool → JSONL → Projector → Renderer。结尾诚实说明：Windows 优先、未签名、本地受信用户模型、三个 Provider Profile、没有 Hosted Edition，与成熟 Coding Agent 仅部分对齐。

## 三分钟精简版

用户问题与对象模型 → 隔离 Task → 一次 Tool / Permission → Diff / Undo → 明确本地与安全边界。

## 三十分钟扩展版

补充 Provider Vault、MCP / Skill Discovery、GitHub Connection / Push / PR、Archive / Activity、原始 JSONL 恢复证据和自动化测试。
