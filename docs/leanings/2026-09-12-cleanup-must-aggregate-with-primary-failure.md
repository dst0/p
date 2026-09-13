# 2026-09-12 — Cleanup must aggregate with the primary failure

- **Status:** Resolved
- **Task/context:** Finalizing evaluator, candidate, authentication, receipt, and agent-directory resources.
- **Unexpected observation or failure:** The first cleanup exception stopped later cleanup and could replace the primary execution error.
- **Evidence:** Fault-injected regressions showed later callbacks were skipped and only one failure reached the caller.
- **Approaches tried:**
  - **Attempt:** Sequence cleanup in one `finally` block.
    - **Outcome:** Did not work
    - **Why:** JavaScript exception propagation aborts the remaining statements and obscures earlier context.
  - **Attempt:** Attempt independent cleanup operations and flatten all failures after preserving the primary error first.
    - **Outcome:** Worked
    - **Why:** Every eligible resource gets a cleanup attempt and diagnostics retain causal order.
- **Root cause:** Cleanup was modeled as a linear happy path rather than independent best-effort obligations.
- **Resolution:** Outer and internal recording, startup-evidence, and freeze finalizers attempt every safe operation and throw aggregates containing the primary first and every cleanup failure.
- **Verification:** `benchmark-run-finalization.test.ts`, `evaluation-freeze.test.ts`, and `interruption-resource-finalization.test.ts` cover construction rollback, aggregation, and callback attempts.
- **Prevention/follow-up:** Keep mutable-unsafe skips explicit; never hide them as successful cleanup.
- **Reusable learning:** Best-effort cleanup means attempt all independent obligations, then aggregate without losing the primary failure.
- **References:** `benchmarks/test/workloads/benchmark-run-finalization.test.ts`
