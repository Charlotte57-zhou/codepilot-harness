## Problem and decision

<!-- What user failure is addressed, what evidence supports it, and why this option? -->

## State ownership and data flow

<!-- Trace UI -> server -> runtime/tool/model -> JSONL -> projector -> UI. -->

## Verification

- [ ] Focused tests
- [ ] `npm test`
- [ ] `npm run check:context`
- [ ] `npm run check:privacy`
- [ ] Actual Electron window inspected for user-visible changes
- [ ] No key, transcript, private path, runtime state, or unrelated change included

## Breaking change / risk / rollback

<!-- v0.1 does not add compatibility paths. State the current contract and rollback. -->
