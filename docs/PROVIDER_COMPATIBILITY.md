# Provider 兼容性

CodePilot 对外提供三个真实 Provider Profile。`fake` 是只用于测试与演示的内部确定性实现。

| Profile | Adapter | 当前证据 | 对齐状态 |
| --- | --- | --- | --- |
| Anthropic | Claude Agent SDK 原生配置 | Profile、配置与 Runtime Contract 测试 | 部分对齐；公开版本未执行真实 Credential Smoke |
| DeepSeek | Anthropic-compatible Endpoint Profile | Profile 校验与 Runtime 配置测试 | 部分对齐；Endpoint / Model 行为取决于 Provider 兼容性 |
| Moonshot | Anthropic-compatible Endpoint Profile | Profile 校验与 Runtime 配置测试 | 部分对齐；公开版本未执行真实 Credential Smoke |

未知 Provider 会在配置阶段失败，不继承旧别名；Base URL 和 Model Name 不会被静默重写。

Provider Key 只通过 Server 侧 Settings / Vault 路径接收。Provider Settings API 不返回 Key，Key 也不应进入 Renderer State、JSONL、Screenshot 或 Git。`.env.example` 是 Server 开发时的进程环境变量模板，CodePilot 不会自动加载该文件。

Provider Capability 在 Run 开始时冻结。只有目标 Endpoint 确实支持对应 Input、Tool 或 Reasoning 行为时，才应启用 Override。
