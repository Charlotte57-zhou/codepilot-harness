# Controlled Eval Bad Case ledger

## BC-001 — read-only task rejected by the completion gate

- **Freeze / model:** product `a1588bb`; `deepseek-v4-flash` on both adapters.
- **Observed result:** CodePilot 5/6 versus Claude CLI 6/6 in the valid six-case run. CodePilot made zero file changes and its fixture tests passed, but the run ended as `agent_error` after the completion gate repeatedly demanded mutation evidence.
- **Root cause:** the mutation classifier matched positive words such as “modify/create/delete” inside a global negative instruction. `DeliveryContract` therefore froze `mutation.expected=true` for a read-only task.
- **Responsibility decision:** `DeliveryContract` owns task acceptance intent. The duplicated fallback classifier in `RunProgressLedger` was removed; the ledger now consumes the same canonical classifier.
- **Fix:** global Chinese/English no-write intent overrides mutation expectation, while scoped constraints such as “fix source but do not change tests” remain mutation tasks.
- **Verification:** 243/243 repository tests; targeted post-fix comparison passed 1/1 for both CodePilot and Claude CLI; CodePilot completed with zero changed files. Additional classifier tests cover a paraphrased Chinese read-only instruction and an English scoped mutation instruction.
- **Remaining uncertainty:** the full six-case post-fix suite was not counted because a provider connection incident caused simultaneous failures in both adapters. The pre-fix valid five passing CodePilot cases plus full repository regression are retained as non-regression evidence, not presented as a post-fix 6/6 score.
- **Product meaning:** this was a Harness false-negative completion failure rather than a model inability or an unauthorized mutation. The fix belongs in the frozen acceptance contract, not in a one-sentence prompt patch.
