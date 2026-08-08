# Evaluation result index

| Artifact | Meaning |
| --- | --- |
| `pre-fix-2026-08-04.json` / `.md` | Valid frozen six-case comparison before the Bad Case fix: CodePilot 5/6, Claude CLI 6/6 |
| `post-fix-readonly-2026-08-04.json` / `.md` | Targeted regression after the fix: both adapters 1/1; zero file changes |

`latest.*` is a local rebuild target and is ignored. Raw records and workspaces are also ignored. A post-fix full-suite attempt coincided with provider connection instability and is excluded rather than blended into the valid comparison.

The committed evidence therefore supports two bounded claims only:

1. Before the fix, CodePilot passed five of six small synthetic cases and failed the read-only completion contract; Claude CLI passed six of six.
2. After the contract-owner fix, the exact failing case passed for both adapters. Unit tests also cover paraphrased global read-only instructions and scoped “change source, not tests” constraints.

It does not support a claim that the entire six-case suite is 6/6 after the fix or that CodePilot is generally equivalent to Claude CLI.
