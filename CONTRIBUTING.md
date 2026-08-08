# Contributing to CodePilot

Thank you for improving the local harness. Keep changes small, evidence-backed, and inside the product's stated boundaries.

## Development setup

```powershell
git clone https://github.com/Charlotte57-zhou/codepilot-harness.git
cd codepilot-harness
npm ci
npm test
npm run desktop
```

Use Node.js 22+ on Windows. Never commit provider keys, `.env`, JSONL transcripts, application data, personal paths, screenshots containing private repositories, or generated binaries.

## Change process

1. Open an issue describing the user problem, current evidence, and intended scope.
2. Create a focused branch and preserve unrelated work.
3. Trace UI -> server -> runtime -> tool/model -> JSONL -> projector -> UI before changing ownership.
4. Add or update tests for success, failure, cancellation, and recovery paths that are affected.
5. Run `npm test`, `npm run check:context`, and `npm run check:privacy`.
6. For UI changes, run `npm run ui:capture` and inspect the actual Electron window.
7. Submit a pull request using the repository template.

## Design rules

- The Claude Agent SDK remains the only Agent Loop.
- JSONL is the session fact source; projections and snapshots must be rebuildable.
- One fact has one owner. Do not repair runtime failures with renderer-only state.
- Tool paths must remain under the active workspace; permission approval is separate from OS isolation.
- Do not add migration or compatibility paths for pre-0.1 private formats. Contract changes are breaking and must be documented.
- Comparison claims use only aligned, partially aligned, or not aligned.

By participating, you agree to follow the Code of Conduct and license your contribution under Apache-2.0.
