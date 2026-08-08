# Current state

## Release decision

CodePilot v0.1.0 is scoped as a local-only, Windows-first open-source interview project. The hosted interview deployment is removed from the release. Current schemas are breaking contracts; pre-release local state is not migrated.

## Verified implementation scope

- Claude Agent SDK is the only Agent Loop.
- Project/Task/Run, current WorkspaceTarget identity, JSONL fact source, projections, cancellation, repair, and resume are implemented.
- SDK filesystem arguments are validated under the active workspace before permission execution.
- Electron covers projects/recent tasks, isolated Git worktrees, diff/undo, GitHub CLI delivery, archives/activity, theme, Skills/MCP, and provider vault settings.
- Public provider profiles are Anthropic, DeepSeek, and Moonshot; fake is internal.
- The public exporter uses an explicit allowlist, privacy scan, and per-file manifest verification.

## Known boundaries

Unsigned Windows artifact; no OS sandbox for Bash; same-user loopback trust; no cross-platform release evidence; no live-provider credential smoke in the clean public release; narrower Skills/MCP/recovery depth than mature coding agents.

## Next release priorities

Signed builds/provenance, real-provider smoke evidence, accessibility/narrow-window hardening, transcript export/redaction, and stronger process isolation research.
