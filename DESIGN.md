# CodePilot design

## Design decision

Use the Claude Agent SDK as the only Agent Loop and keep CodePilot responsible for the surrounding local product contract. This avoids a second hidden loop while making permission, state, recovery, and UI behavior independently inspectable.

## Experience principles

1. **Task before chat:** establish project, target, task, and run context before rendering a conversation.
2. **Progressive evidence:** the default surface summarizes; raw events remain available for audit.
3. **Permission at the boundary:** explain the requested capability and validate workspace paths before execution.
4. **Durability over optimism:** terminal state, tool results, and resume behavior derive from persisted events.
5. **Reversible delivery:** worktree isolation, diff, undo, push, and PR actions form one workflow.

## Key choices and tradeoffs

### Append-only JSONL

JSONL is simple to inspect and rebuild. Projectors derive the task/run UI and recovery state. The tradeoff is local-file concurrency and compaction complexity; v0.1 is single-user and does not pretend JSONL is a multi-tenant database.

### Loopback server plus Electron

The renderer receives product DTOs, not provider secrets or direct filesystem authority. The loopback server owns runtime and persistence. The boundary improves secret handling and testability, but the local OS user remains trusted and the server must never be publicly exposed.

### SDK built-ins plus CodePilot policy

The SDK executes its built-in tools. CodePilot validates filesystem targets, freezes capability/permission preferences per run, and records decisions. Bash is not parsed into a false sandbox; OS isolation remains future work.

### Breaking current schemas

v0.1 removes application-owned legacy migrations and inferred projections. Saved registries, WorkspaceTarget identity, run IDs, tool results, and task progress must satisfy the current contract. This simplifies ownership and makes invalid state fail visibly, at the cost of discarding pre-release local state.

## Main interaction

Connect project -> create isolated task -> describe objective -> observe plan/tool call -> approve -> stream result -> review diff -> undo or deliver -> interrupt/resume if needed.

## Visual language

Dense, calm desktop workbench; readable hierarchy; status conveyed by text plus color; model content is primary; technical evidence is available without dominating the task narrative. Motion communicates state only and respects reduced-motion settings.
