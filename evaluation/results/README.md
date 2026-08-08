# 评测结果索引

| Artifact | 含义 |
| --- | --- |
| `pre-fix-2026-08-04.json` / `.md` | 修复 Bad Case 前冻结的有效六用例对比：CodePilot 5/6，Claude CLI 6/6 |
| `post-fix-readonly-2026-08-04.json` / `.md` | 修复后的目标回归：两个 Adapter 均为 1/1，文件修改数为零 |

`latest.*` 是本地重建目标，已被 Ignore；原始记录与 Workspace 也被 Ignore。修复后一次完整评测遇到 Provider Connection Instability，因此被排除，没有与有效对比混合。

已提交证据只支持两条边界明确的结论：

1. 修复前，CodePilot 在六个小型 Synthetic Case 中通过五个，并在只读 Completion Contract 上失败；Claude CLI 通过六个。
2. 修复 Contract Owner 后，原失败用例在两个 Adapter 上都通过；单元测试还覆盖全局只读指令的改写，以及“改源码、不改测试”的局部约束。

这些证据不支持“修复后完整六用例已达到 6/6”，也不支持“CodePilot 与 Claude CLI 普遍等价”。
