# Security policy

## Supported version

Security fixes are accepted for the latest tagged release. v0.1.0 is local, Windows-first software and is not a hosted multi-tenant boundary.

## Reporting a vulnerability

Use GitHub's private **Security Advisories -> Report a vulnerability** flow. Include the affected version, reproduction, impact, and any evidence that can be shared without secrets. Do not open a public issue for an unpatched vulnerability.

Maintainers will acknowledge a report within seven days, assess severity and scope, and coordinate disclosure after a fix is available.

## Security model

- The Electron renderer never receives provider API keys; credentials are stored by the server-side vault using the OS protection available on Windows.
- JSONL transcripts record agent and tool events, not provider keys. They can still contain source code and prompts and must be treated as sensitive local data.
- Read/Glob/Grep and write/edit SDK tool paths are canonicalized against the active workspace before permission execution, including traversal and symlink escape checks.
- The loopback server assumes a single trusted local OS user. It is not designed for exposure on a LAN or the public internet.
- CodePilot permissions are an application policy, not an OS sandbox. Bash inherits the user's process authority; full-access mode deliberately bypasses per-command approval.
- GitHub CLI and MCP servers are external trust boundaries. Review their requested scopes and outputs.

## Secrets and privacy

The public source exporter uses an explicit file allowlist and scans for common secret formats, complete user paths, runtime logs, JSONL, and private workflow metadata. Automated scanning reduces risk but does not replace human release review. Revoke any credential that may have been exposed.
