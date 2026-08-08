# Claude Agent SDK and coding-agent alignment

## Classification

| Capability | Assessment | Evidence/boundary |
| --- | --- | --- |
| single SDK agent loop | aligned | `ClaudeAgentRuntime` delegates iteration to SDK query |
| streaming tool/model events | aligned | normalized run-scoped JSONL and SSE projections |
| permission hook | aligned | SDK `canUseTool` plus CodePilot policy/events |
| workspace filesystem guard | partially aligned | canonical path/symlink checks; no OS sandbox |
| durable sessions/resume | partially aligned | local JSONL recovery and new-run resume; not ecosystem parity |
| Skills | partially aligned | current directory-format catalog and frozen capability snapshot |
| MCP | partially aligned | curated/local connections and tool visibility; narrower lifecycle coverage |
| subagents | not aligned | no product claim in v0.1 |
| hooks/ecosystem breadth | not aligned | outside v0.1 scope |
| Git worktree/diff/undo | aligned with CodePilot product scope | local delivery workflow, not an SDK parity claim |
| cross-platform isolation | not aligned | Windows-first, trusted local-user boundary |

CodePilot does not reproduce the internals or brand interface of Claude Code or Codex. Public behaviors and documentation inform product boundaries; CodePilot's control plane is independently implemented around documented SDK contracts.
