# 2026-09-21 — Child-process tests need full-suite timeout margin

- **Status:** Resolved
- **Task/context:** Running the full non-e2e suite before publishing the compiled-project-instruction fallback fix.
- **Unexpected observation or failure:** `startup-session-name.test.ts` killed its CLI child at 20 seconds during the full suite, so the result reported a signal and null exit code instead of the expected validation failure.
- **Evidence:** The full suite recorded one failure after the child hit its 20-second kill timer, while the same two-test file passed in 15.95 seconds when run alone.
- **Approaches tried:**
  - **Attempt:** Re-ran the focused test without changing implementation behavior.
    - **Outcome:** Worked
    - **Why:** Lower contention let both CLI subprocesses finish before the harness deadline, proving the assertion and product behavior were sound.
- **Root cause:** The fixed 20-second child-process timeout had insufficient margin above the focused runtime and became the tested behavior under full-suite load.
- **Resolution:** Increased the harness timeout to 60 seconds and documented that it is full-suite load margin, not an expected product latency.
- **Verification:** The focused `startup-session-name.test.ts` run passed both tests; the complete suite is rerun after the timeout change.
- **Prevention/follow-up:** Size successful child-process regression timeouts for measured full-suite contention rather than focused execution alone.
- **Reusable learning:** A child-process timeout must distinguish a hung product from a merely contended full-suite run; a deadline near focused runtime creates false regressions.
- **References:** `packages/coding-agent/test/startup-session-name.test.ts`
