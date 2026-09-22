# 2026-09-21 — Sealed adapter termination requires tree confirmation

- **Status:** Resolved
- **Task/context:** Running sealed evaluator-side holdout adapters after each certified agent task.
- **Unexpected observation or failure:** The adapter raced child `close` against a failure promise that was rejected only after termination completed. A process that overflowed stderr and exited cleanly could win the close race. Ordinary failures also swallowed an unconfirmed process-tree termination, allowing later cleanup to treat mutable artifacts as safe.
- **Evidence:** Adversarial review identified the race in `certification-holdout-execution.ts`; added regressions cover a valid-prefix overflow, stderr overflow followed by exit, a short timeout, an attempted fork, and an injected unconfirmed tree termination.
- **Approaches tried:**
  - **Attempt:** Reject only after the asynchronous termination result.
    - **Outcome:** Did not work
    - **Why:** A clean close could settle first and accept output despite a prior bound or timeout failure.
  - **Attempt:** Signal failure synchronously, await termination before every failure result, and confirm the process group after a normal close.
    - **Outcome:** Worked
    - **Why:** The evaluator rejects bounded-protocol failures deterministically and escalates uncertain cleanup to the runner safety path.
- **Root cause:** Child exit status is not equivalent to process-tree completion, and cleanup certainty was represented as an ordinary evaluator failure.
- **Resolution:** The sealed adapter disables process forking, performs bounded process-tree confirmation after clean close, and propagates `BenchmarkProcessTerminationUnconfirmedError` instead of returning a normal failed holdout check.
- **Verification:** `certification-holdout-execution.test.ts` verifies successful public APIs, malformed and overflow protocols, timeout, write denial, fork denial, and unsafe termination propagation; `npm run check` passes.
- **Prevention/follow-up:** Keep evaluator-owned subprocess results separate from cleanup safety. Any future evaluator child must distinguish a confirmed domain failure from unconfirmed process termination.
- **Reusable learning:** Never infer tree safety from a root child close event; fail closed and preserve unsafe-artifact state until the complete process group is confirmed gone.
- **References:** `benchmarks/src/workloads/certification-holdout-execution.ts`, `benchmarks/src/harness/process-control.ts`, `benchmarks/test/workloads/certification-holdout-execution.test.ts`
