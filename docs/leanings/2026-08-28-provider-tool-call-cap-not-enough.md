# 2026-08-28 — Provider output caps do not solve the local tool-call stall

- **Status:** Partial
- **Task/context:** rc.49 and rc.50 live task-3 project-instruction benchmark runs against the local Qwen provider.
- **Unexpected observation or failure:** Lowering the copied model metadata `maxTokens` from 16,384 to 4,096 did not produce a correctness sample or materially shorten the requirement-definition loop.
- **Evidence:** rc.49 reached four definitions and three repairs in about 1,000 seconds before interruption; rc.50 reached at least three definitions and six repairs in about 950 seconds before interruption. Both had zero samples and no hidden reasoning blocks.
- **Approaches tried:**
  - **Attempt:** Keep the provider at 16,384 output tokens with thinking disabled and compatibility metadata.
    - **Outcome:** Did not work
    - **Why:** The model continued long requirement-audit tool-call generation without reaching a sample.
  - **Attempt:** Cap provider output at 4,096 tokens through an isolated models file.
    - **Outcome:** Partial
    - **Why:** The cap bounded individual responses but did not address the model’s slow multi-turn requirement-repair behavior.
- **Root cause:** The dominant cost is not hidden reasoning or one oversized response alone; it is repeated low-throughput requirement-definition/repair turns from the local model. A definitive provider-side cause remains unproven.
- **Resolution:** Keep the controller’s cross-cycle bound and agent-loop terminal short-circuit as the safety mechanism; do not treat a lower output cap as the primary liveness fix.
- **Verification:** Both runs emitted semantic progress and no thinking events, but neither passed the correctness gate. The result is an infrastructure/liveness finding, not a task-quality comparison.
- **Prevention/follow-up:** Benchmark a faster or instruction-tuned provider separately, and add a bounded provider-turn or tool-argument generation metric before spending full 3–5 repetition budgets.
- **Reusable learning:** Token caps limit response size; they do not guarantee bounded end-to-end agent turns when the model repeatedly regenerates structured tool calls.
- **References:** `benchmarks/results/2026-08-28-v5.0.1-rc.49-task3-thinking-off-qwen-compat-paired-v1/report.md`; `benchmarks/results/2026-08-28-v5.0.1-rc.50-task3-thinking-off-qwen-compat-4096-paired-v1/report.md`.
