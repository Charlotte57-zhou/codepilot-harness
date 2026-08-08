# Bash 安全边界

Bash 是能力强大的子进程工具，不是 Sandbox。

## CodePilot 当前实施的约束

- Run 必须具有显式 WorkspaceTarget 和 Working Directory；
- Permission Mode 在 Run 开始时冻结；
- 普通模式会在敏感命令执行前要求用户决策；
- Request、Decision、Result、Cancellation 和 Failure 都记录为 Run Event；
- 已知 Secret 会在进入持久化或 UI Payload 前由责任边界脱敏。

## CodePilot 当前没有实施的约束

命令仍可使用当前 OS 用户权限、创建进程、访问网络资源和引用 Workspace 外路径。解析 Shell 文本不能形成可靠的隔离边界，因此 CodePilot 不把 Denylist 宣称为 Sandbox。Full Access Mode 会按设计取消逐命令审批。

运行不受信任的 Repository 时，应使用低权限 OS Account、检查命令、保留备份，并通过 VM、Container 或 OS Sandbox 建立真正的隔离。更强的进程隔离属于后续架构研究项。
