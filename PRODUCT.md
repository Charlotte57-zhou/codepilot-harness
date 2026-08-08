# CodePilot product definition

## Decision

CodePilot is a local control plane for a coding agent, built to demonstrate how an AI product turns an SDK loop into a trustworthy workflow. Its beachhead user is an evaluator, AI product manager, or developer who needs to see what the agent did, what it may do next, and how work can be reviewed or recovered.

## User problem

Raw model/SDK loops can edit code, but they do not by themselves provide durable task identity, permission explanation, Git isolation, recovery evidence, or a product-quality review surface. Users need confidence and control without reading terminal logs.

## Core job

> When I delegate a bounded repository task, help me isolate the work, observe and govern tool use, review the change, and recover or undo it without losing the causal record.

## Product model

- **Project** owns a connected repository and its workspace targets.
- **Task** owns one user objective and one target, normally an isolated Git worktree.
- **Run** owns one execution attempt, frozen runtime preferences, tool batches, and terminal state.
- **JSONL** owns durable session facts; UI views are projections.

## v0.1 value

1. Confidence: tool intent, permission state, activity, and failures are visible.
2. Control: workspace paths, approvals, cancellation, diff, and undo are explicit.
3. Continuity: runs can resume from durable events after interruption.
4. Isolation: new tasks can use separate Git worktrees and GitHub delivery actions.
5. Extensibility: Skills and MCP add capabilities without replacing the single loop.

## Differentiation

The differentiation is not model intelligence. It is the coherent local workflow around the loop: state ownership, policy, auditability, recovery, and delivery. Compared with mature coding agents, CodePilot is aligned on the control-plane concepts, partially aligned on depth and robustness, and not aligned on platform reach or ecosystem scale.

## Success criteria

A new developer can install, run the fixture demo, observe a permission decision and file edit, inspect/undo the diff, interrupt/resume a run, execute tests, and understand the security boundary from public documentation.

## Non-goals

Hosted service, multi-tenancy, autonomous production deployment, cross-platform parity, model/provider marketplace, historical private-state migration, or claims of complete Claude Code/Codex parity.
