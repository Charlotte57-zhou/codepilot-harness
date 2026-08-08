# Bash security boundary

Bash is a powerful child-process tool, not a sandbox.

## What CodePilot enforces

- the run has an explicit WorkspaceTarget and working directory;
- a permission mode is frozen at run start;
- normal modes surface a user decision before a sensitive command;
- requests, decisions, results, cancellation, and failures are recorded in run events;
- secrets are redacted from persisted/UI payloads where the owning boundary recognizes them.

## What CodePilot does not enforce

A command can use the current OS user's authority, spawn processes, access network resources, and reference paths outside the workspace. Parsing shell text cannot provide a reliable containment boundary, so CodePilot does not label a denylist as isolation. Full-access mode deliberately removes per-command approval.

Use a low-privilege OS account, inspect commands, keep backups, and use a VM/container or OS sandbox when executing untrusted repositories. Strong process isolation is a future architecture item.
