# Quality gates

A release is eligible only when every applicable gate has fresh evidence from the clean public export.

## Required gates

1. `npm ci` completes from `package-lock.json` on Node.js 22+.
2. `npm test` passes all root tests.
3. `npm run check:context` reports no broken canonical links/stale claims.
4. `npm run check:privacy` passes against the exact public allowlist.
5. `npm run export:public` creates a clean directory and `npm run verify:public -- --input <DIR>` validates every manifest hash.
6. In the exported tree, repeat install, tests, context, and privacy checks.
7. `npm audit --audit-level=high` reports no high/critical finding.
8. `npm run package:win` produces the expected portable executable; record SHA-256 and unsigned status.
9. Start Electron from the release source and inspect the real window at wide and narrow sizes. Exercise project/task creation, one permission decision, tool trace, diff/undo, cancellation/resume, settings, and error/empty states.
10. Review Git status and the final public repository tree; public history begins with one clean release commit and contains no private workflow directories, runtime state, transcripts, or hosted deployment.

GitHub-hosted Windows runners do not expose a usable user DPAPI PowerShell module. CI therefore skips the single real-DPAPI switching smoke; it still runs vault isolation/concurrency tests. A release owner must run the full suite on a local Windows user session, where that smoke is required to pass.

## Invariants under test

- one SDK agent loop;
- one durable result per tool call;
- current WorkspaceTarget/run/batch identity on persisted events;
- deterministic tool result ordering;
- provider keys absent from renderer/JSONL/Git;
- workspace path validation before execution;
- resume uses the latest task and frozen preferences;
- terminal UI state derives from explicit run-state events;
- public exporter is allowlist-based rather than ignore-based.

## Evidence limits

Unit tests establish contracts, not real-provider availability, OS sandboxing, production scale, or comparative model quality. Visual capture establishes rendered states, not full accessibility. Unsigned binaries trigger Windows reputation warnings.
