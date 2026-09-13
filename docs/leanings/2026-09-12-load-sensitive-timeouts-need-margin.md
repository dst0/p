# 2026-09-12 — Load-sensitive timeouts need full-suite margin

- **Status:** Resolved
- **Task/context:** Running all workload tests concurrently after benchmark hardening.
- **Unexpected observation or failure:** Child-process regressions passed alone but failed under concurrent process load: startup-sensitive event streams emitted too late, a failed-cleanup helper settled after its fixed wait, overflow cleanup exceeded short wall assertions, and interruption evidence appeared after polling deadlines.
- **Evidence:** The 442-test concurrent run passed 436 tests and failed six; a heavier focused concurrent run exposed three more short bounds. Failures included `rawEventCount: 0`, `code: null`, a helper outcome of `hung`, elapsed times up to eleven seconds, or `timed out waiting for child evidence`; the affected tests passed sequentially.
- **Approaches tried:**
  - **Attempt:** Treat the isolated pass as sufficient.
    - **Outcome:** Did not work
    - **Why:** The regression is specifically sensitive to scheduler delay under concurrent child-process load.
  - **Attempt:** Preserve each semantic boundary while increasing startup grace, helper/evidence waits, and the gap between prompt termination bounds and larger nominal timeouts.
    - **Outcome:** Worked
    - **Why:** The semantic condition remains identical with realistic full-suite scheduling headroom.
- **Root cause:** Process startup, scheduling, process-tree cleanup, and evidence polling bounds were sized against focused runtimes instead of measured concurrent-suite load.
- **Resolution:** Added startup grace before intentional inactivity, waited for helper settlement before fixture cleanup, retained prompt failure termination at less than half a larger nominal timeout, added a hard deadline for intentional non-progress, and extended process evidence polling without changing cancellation assertions.
- **Verification:** Sequential focused runs passed all 34 tests across the five modified files, and a concurrent run of the initially demonstrated six load-sensitive cases passed 6/6; the complete benchmark suite remains the required final confirmation.
- **Prevention/follow-up:** Size child startup, cleanup, and evidence waits against concurrent suite load while keeping prompt-failure assertions materially below nominal deadlines.
- **Reusable learning:** Concurrency-sensitive process tests need separate startup, semantic, cleanup, and hard-deadline margins; increasing one timeout indiscriminately can erase the behavior under test.
- **References:** `benchmarks/test/agents/oversized-cumulative-events.test.ts`, `benchmarks/test/agents/turn-cleanup-failure.test.ts`, `benchmarks/test/agents/turn-liveness-timeout.test.ts`, `benchmarks/test/agents/turn.test.ts`, `benchmarks/test/harness/process-interruption.test.ts`.
