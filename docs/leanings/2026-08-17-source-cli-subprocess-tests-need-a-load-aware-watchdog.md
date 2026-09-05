# 2026-08-17 — Source CLI subprocess tests need a load-aware watchdog

- **Status:** Resolved
- **Task/context:** Verifying the early `--name` validation fix in the complete coding-agent test suite.
- **Unexpected observation or failure:** The focused subprocess regression passed in about six seconds, but the same test still crossed its 10-second child watchdog during the full concurrent suite even though validation now happens before session initialization.
- **Evidence:** The focused parser and subprocess tests passed 81/81. In two complete suite runs, the child was killed at the fixed 10-second deadline and returned `code=null`; the second run occurred after the fail-fast parser fix. The package Vitest configuration allows 30 seconds per test.
- **Approaches tried:**
  - **Attempt:** Assume early argument validation alone would keep the source CLI subprocess below 10 seconds under every suite load.
    - **Outcome:** Partial
    - **Why:** It removed migrations/session/runtime work for invalid names, but Node still has to load the full TypeScript CLI import graph before calling `main`.
  - **Attempt:** Give the child a 20-second watchdog inside the package's existing 30-second test ceiling.
    - **Outcome:** Worked
    - **Why:** The watchdog remains bounded and leaves time for Vitest cleanup while accommodating observed cold-load contention.
- **Root cause:** The test conflated a production hang with source-module load time and used a budget too close to the loaded-suite worst case.
- **Resolution:** Keep fail-fast parser validation and raise only the test child watchdog from 10 to 20 seconds; no production timeout changes.
- **Verification:** Run the focused CLI tests, `npm run check`, and the full `npm run test:unit` with `GIT_TEST_DEFAULT_INITIAL_BRANCH_NAME=master`.
- **Prevention/follow-up:** Size subprocess watchdogs below the enclosing test timeout but above measured loaded-suite startup, and pair them with direct unit coverage so correctness is not inferred from timing alone.
- **Reusable learning:** A source-entrypoint integration test measures both behavior and module-load cost; its watchdog must account for loaded-suite contention without becoming unbounded.
- **References:** `packages/coding-agent/test/startup-session-name.test.ts`, `packages/coding-agent/vitest.config.ts`
