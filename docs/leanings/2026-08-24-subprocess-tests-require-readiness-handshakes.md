# 2026-08-24 — Subprocess tests require readiness handshakes

- **Status:** Resolved
- **Task/context:** Migrating the benchmark harness tests from a flat JavaScript script directory into a strict TypeScript benchmark project.
- **Unexpected observation or failure:** The full parent suite intermittently observed a supposedly resistant child exit on `SIGTERM`, while process-level signal tests timed out before reaching their asserted behavior.
- **Evidence:** Under concurrent repository activity, the 301-test suite reported `SIGTERM` instead of `SIGKILL` after aborting a child on a fixed timer, and two process tests exceeded a five-second budget during startup. The same focused behavior had passed on an idle machine.
- **Approaches tried:**
  - **Attempt:** Rerun the suite without changing the test contract.
    - **Outcome:** Did not work
    - **Why:** A rerun would not remove the race between child initialization and the parent's fixed abort timer.
  - **Attempt:** Signal the resistant child only after an IPC readiness message, keep elapsed assertions well below the production timeout, extend process-test startup budgets, and bound file-level test concurrency.
    - **Outcome:** Worked
    - **Why:** The assertions now begin from an observed lifecycle state and test behavior rather than scheduler speed.
- **Root cause:** Fixed wall-clock delays assumed that a newly spawned Node process had installed its signal handler. Concurrent TypeScript test startup invalidated that assumption, and splitting tests into more files increased file-level concurrency.
- **Resolution:** The resistant-child test uses an IPC readiness handshake, non-performance signal tests allow loaded startup, overflow assertions retain a two-second bound against a ten-second production timeout, and the benchmark suite caps file concurrency at four.
- **Verification:** `npm run test:benchmarks`, `npm run test:scripts`, and `npm run check` pass with the revised lifecycle contract.
- **Prevention/follow-up:** New subprocess lifecycle tests must synchronize on explicit readiness and must not use tight startup timing as a proxy for behavior.
- **Reusable learning:** Synchronize subprocess tests on observable readiness; reserve elapsed-time thresholds for broad timeout-bound guarantees, not process-start assumptions.
- **References:** `benchmarks/test/project-instructions/run-interruption.test.ts`, `benchmarks/test/project-instructions/run-signal-process.test.ts`, `benchmarks/test/agents/turn.test.ts`, `package.json`
