# 2026-08-21 — Single-run prompt benchmarks can improve quality while regressing efficiency

- **Status:** Partial
- **Task/context:** Continue the compiled project-instruction benchmark on the durable workflow saga after the user accepted the earlier monolith regression and requested tasks three and four.
- **Unexpected observation or failure:** Task three fell from 100/100 to 95/100 because generated event hashes omitted payload data, while task four rose from 105/158 to 121/158 but retained its timeout and used 158.3% more tokens with six additional tool errors.
- **Evidence:** The same-model task-three comparison was 95 versus 100 weighted points. The task-four comparison was 121 versus 105, 2,815,332 versus 1,089,820 tokens, 13 versus 7 tool errors, and approximately 3,600 seconds for both runs.
- **Approaches tried:**
 - **Attempt:** Infer a universal regression from task three's single failed invariant.
  - **Outcome:** Rejected
  - **Why:** Task four subsequently improved sixteen weighted points and repaired several baseline invariants, showing fixture- and sample-dependent outcomes.
 - **Attempt:** Infer a universal win from the net score increase across tasks three and four.
  - **Outcome:** Rejected
  - **Why:** Both are single samples, task three lost correctness, and task four's token and tool-error costs increased materially.
- **Root cause:** The benchmark combines stochastic model choices with multiple outcome dimensions. Richer retrieved instructions may change audit behavior and token consumption, but these unpaired single runs cannot isolate that effect from sampling, cache, provider latency, or implementation-path variance.
- **Resolution:** Preserve both outcomes as mixed evidence and report quality, status, runtime, tokens, and tool errors independently.
- **Verification:** Completed result files and Brotli recordings exist for both task-three inventory and task-four saga runs, with comparisons against their latest same-model baselines.
- **Prevention/follow-up:** For a causal decision, run randomized paired A/B trials on the same revision with project-instruction processing enabled and disabled, using at least three to five repetitions per fixture and correctness as a hard primary gate.
- **Reusable learning:** Aggregate score can improve while a correctness invariant and efficiency regress; never collapse a one-run agent benchmark into a single win/loss claim.
- **References:** `benchmarks/results/2026-08-21-project-instructions-p-inventory/`, `benchmarks/results/2026-08-21-project-instructions-p-saga/`.
