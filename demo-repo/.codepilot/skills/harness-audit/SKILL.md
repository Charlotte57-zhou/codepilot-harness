---
name: Harness Audit
description: Inspect a small change request before editing and report the relevant files, constraints, and verification plan.
when_to_use: Use before a scoped demo change in this workspace.
version: 1.0.0
allowed-tools: [Read, Glob, Grep]
context: inline
model-invocable: true
user-invocable: true
---

# Harness Audit

Before changing code:

1. Read the workspace `AGENT.md` and the target file.
2. Identify the smallest file set that owns the requested behavior.
3. State one observable acceptance criterion and one rollback action.
4. Keep all reads inside the current workspace.

Return a concise plan. The normal Agent Loop owns any later edit, test, Diff, and revert.
