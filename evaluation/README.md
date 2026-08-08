# Controlled comparison

This package runs a deliberately small comparison between CodePilot and Claude CLI with the same `deepseek-v4-flash` model. It exists to find concrete Harness failures, not to manufacture a leaderboard claim.

## Isolation contract

- Architecture is frozen at the commit recorded in `freeze-manifest.json` before cases run.
- Every adapter/case pair receives a new synthetic workspace. Test files are immutable by validator policy.
- CodePilot receives a new state root and session. Claude CLI uses `--bare --print --no-session-persistence`.
- Cases contain no production repository code or user/session content. Agents see only their fixture and task.
- Raw per-run records and workspaces stay in ignored directories; only normalized results are eligible for Git.
- Credentials are inherited by child processes and are never written to commands, reports, stdout summaries, or artifacts.

## Score meaning

A case passes only when its tests pass, required mutation behavior is satisfied, and every changed file is explicitly allowed. The read-only case additionally requires zero file changes and response evidence. Duration is observational; it is not used to decide correctness.

```powershell
npm run eval:controlled
```

The comparison is intentionally too small for claims about market-wide coding quality. CodePilot's differentiated evidence remains Project/Task isolation, run lifecycle, permission, JSONL audit, recovery, and visible delivery receipts.
