# CodePilot 10-minute interview demo

## Setup

Use the bundled demo repository and the deterministic fake runtime for repeatability. Keep a real provider as an optional appendix, not a dependency of the main proof.

## 0:00-1:00 ? problem and model

?CodePilot is a local control plane around one SDK agent loop. Project owns the repo, Task owns the objective and worktree, Run owns one attempt, and JSONL owns durable facts.? Show the Project/Task/Run hierarchy.

## 1:00-3:00 ? isolated task

Create a new Task in an isolated worktree. Ask: ?Audit the fixture authentication flow, explain the risk, then add a focused regression test and the smallest fix.? Show the selected WorkspaceTarget and clean baseline.

## 3:00-5:30 ? observable agent behavior

Open the run trace. Point out the frozen provider/permission/Skill snapshot, Read/Glob/Grep calls, and the bundled `harness-audit` Skill. When a write or shell action requests approval, explain the capability, workspace path, and consequence before approving.

## 5:30-7:00 ? result and review

Show the modified files, explicit tool results, tests, and Git diff. Separate model narrative from execution evidence. Explain that path validation runs before permission execution and that Bash permission is not an OS sandbox.

## 7:00-8:00 ? reversibility

Use Undo, show the diff return to baseline, then reapply/rerun if desired. This proves delivery control rather than a happy-path chat response.

## 8:00-9:00 ? interruption and recovery

Cancel or stop a run after a tool call, restart/resume, and show a new run ID using the latest task plus prior frozen preferences. Open the event detail to show paired tool result/repair records and explicit terminal state.

## 9:00-10:00 ? architecture and boundary

Trace renderer -> loopback server -> runtime -> SDK tool -> JSONL -> projector -> renderer. Close with the honest boundary: Windows-first, unsigned, local trusted-user model, three provider profiles, no hosted edition, and partial rather than complete parity with mature coding agents.

## Three-minute cut

Problem/model -> isolated Task -> one tool/permission -> diff/undo -> explicit local/security boundary.

## Thirty-minute extension

Add provider vault configuration, MCP/Skill discovery, GitHub connection/push/PR, archive/activity views, raw JSONL recovery evidence, and selected automated tests.
