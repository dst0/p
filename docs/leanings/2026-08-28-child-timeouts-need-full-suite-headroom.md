# 2026-08-28 — Child timeouts need full-suite headroom

- **Status:** Resolved
- **Task/context:** The mandatory full non-e2e gate was run after requirement-verifier fixes and before a live paired benchmark.
- **Unexpected observation or failure:** The unrelated FSWatcher crash regression failed only in the full suite because its successful child process was terminated with exit 143 at its 10-second timeout.
- **Evidence:** The full suite ran 3,223 tests and the watcher child reached 10.24 seconds before termination. The exact test passed independently, but its child still needed 8.79 seconds, leaving only 1.21 seconds of margin for full-suite CPU and import contention.
- **Approaches tried:**
  - **Attempt:** Classify the full-suite result as a product regression.
    - **Outcome:** Did not work
    - **Why:** The assertion reported timeout termination rather than the watcher error behavior the regression is designed to detect.
  - **Attempt:** Reproduce the exact test independently and compare its successful runtime with the configured child deadline.
    - **Outcome:** Worked
    - **Why:** The focused run proved behavior was correct while quantifying that the timeout was too close to normal runtime.
- **Root cause:** The successful child-process deadline had almost no concurrency margin, so normal full-suite contention killed a correct process and produced a false failure.
- **Resolution:** The child timeout was increased from 10 to 20 seconds while preserving a finite hang detector and the same exit-code assertion.
- **Verification:** The exact watcher regression must pass after the change, followed by the complete non-e2e suite under normal concurrency.
- **Prevention/follow-up:** Successful subprocess regressions now require measured full-suite headroom rather than deadlines derived only from isolated execution.
- **Reusable learning:** A focused runtime is the lower bound for a child timeout, not a safe full-suite deadline; retain a finite timeout with explicit contention margin.
- **References:** `packages/coding-agent/test/suite/regressions/2791-fswatch-error-crash.test.ts` and `/private/tmp/p-rc46-full-test-20260828T0113.log.br`.
