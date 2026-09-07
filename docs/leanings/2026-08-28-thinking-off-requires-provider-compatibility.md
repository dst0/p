# 2026-08-28 — Thinking off requires provider compatibility metadata

- **Status:** Partial
- **Task/context:** Diagnosed the long-running task-model turn in the project-instruction paired benchmark and added a reproducible benchmark-only thinking-level control.
- **Unexpected observation or failure:** The live P command accepted `--thinking off`, but the local Qwen task still streamed thousands of hidden-thinking blocks and did not complete within the diagnostic window.
- **Evidence:** The configured model metadata contains `reasoning: true` but no `thinkingLevelMap` or compatibility override. The OpenAI-compatible request builder therefore emitted no disable field for an off request. The interrupted rc.48 cell recorded 2,629 thinking blocks by 350 seconds. A private AI-unit run with only `compat.thinkingFormat: "qwen-chat-template"` added emitted `chat_template_kwargs.enable_thinking=false`, completed in about 25 seconds, and recorded zero thinking blocks.
- **Approaches tried:**
  - **Attempt:** Add a paired-run `--thinking` option and pass `off` to P.
    - **Outcome:** Partial
    - **Why:** The CLI plumbing works, but provider metadata controls whether the API receives a disable instruction.
  - **Attempt:** Temporarily add the Qwen chat-template compatibility declaration to an isolated model snapshot.
    - **Outcome:** Worked
    - **Why:** The request builder emitted the server-specific `enable_thinking=false` control without changing the product default or shared model configuration.
- **Root cause:** Thinking-level semantics are provider/model-specific. An unknown OpenAI-compatible endpoint with a reasoning-enabled Qwen model has no safe generic off mapping, so the server keeps its default reasoning behavior.
- **Resolution:** Keep the benchmark control and evidence field; do not claim it disables reasoning until the model’s authoritative compatibility metadata is supplied. The provider metadata fix remains open and must be validated against the real endpoint before changing production defaults.
- **Verification:** `npm run test:benchmarks` passed all 313 tests; `npm run check` passed; the rc.48 paired diagnostic captured the missing-control behavior; the isolated live AI-unit probe completed with zero thinking blocks.
- **Prevention/follow-up:** Add an explicit compatibility/`thinkingLevelMap` entry for the private Qwen provider through the supported model-configuration path, then run a focused live request assertion before repeating the expensive paired benchmark. Never infer that a CLI thinking flag disabled server reasoning from the argument list alone.
- **Reusable learning:** A thinking-level CLI option is only effective when the resolved model metadata maps it to the provider’s request format; verify the serialized request and one live response before spending a full benchmark run.
- **References:** `benchmarks/src/workloads/thinking-level.ts`, `benchmarks/src/workloads/agent-command.ts`, `benchmarks/src/project-instructions/run-core.ts`, `packages/ai/src/providers/openai-completions/streaming-delta.ts`, `benchmarks/results/2026-08-28-v5.0.1-rc.48-task3-thinking-off-paired-v1`, `/private/tmp/p-rc48-aiunit.log.br`
