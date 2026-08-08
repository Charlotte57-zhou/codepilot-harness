# Provider compatibility

CodePilot exposes three real-provider profiles. `fake` is internal and deterministic for tests/demo.

| Profile | Adapter | Current evidence | Status |
| --- | --- | --- | --- |
| Anthropic | Claude Agent SDK native configuration | profile/config/runtime contract tests | partially aligned; live credential smoke not part of this public release |
| DeepSeek | Anthropic-compatible endpoint profile | profile validation and runtime configuration tests | partially aligned; endpoint/model behavior depends on provider compatibility |
| Moonshot | Anthropic-compatible endpoint profile | profile validation and runtime configuration tests | partially aligned; live credential smoke not part of this public release |

Unknown providers fail configuration instead of inheriting a legacy alias. Base URLs and model names are not silently rewritten.

Provider keys are accepted by the server-side settings/vault path only. They are never returned by provider settings endpoints and must not enter renderer state, JSONL, screenshots, or Git. `.env.example` is a process-variable template for server development; CodePilot does not auto-load it.

Provider capability declarations are frozen at run start. Overrides should be enabled only when the chosen endpoint actually supports the relevant input/tool/reasoning behavior.
