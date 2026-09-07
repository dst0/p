# 2026-08-28 — CLI fixture timeout under aggregate coverage

- **Status:** Resolved
- **Task/context:** Running the repository-wide `./test.sh test:coverage` gate after adding task-verification coverage.
- **Unexpected observation or failure:** The real CLI session-isolation regression test timed out at its 30-second Vitest test limit during aggregate coverage. The failure occurred after the prior package coverage phase and did not reproduce in focused or ordinary full-package runs.
- **Evidence:** The aggregate coverage log reported `session-isolation-cli.test.ts` taking 30,069ms and returning a timeout failure. The test launches the TypeScript CLI in two child processes, while the focused coding-agent test suite and prior full unit suite completed successfully.
- **Approaches tried:**
  - **Attempt:** Treat the timeout as a session-isolation or provider-protocol regression.
    - **Outcome:** Did not work.
    - **Why:** The same test's behavior and assertions pass outside aggregate coverage; only the fixed test deadline was exceeded.
  - **Attempt:** Stop the coverage run and inspect the child-process boundary.
    - **Outcome:** Worked.
    - **Why:** The timeout is owned by the test, not by the CLI's protocol assertions.
- **Root cause:** A 30-second test deadline was too tight for two instrumented CLI subprocesses under aggregate package coverage and event-loop load.
- **Resolution:** Increased only this test's bounded timeout to 120 seconds; the test still fails closed if the child processes hang.
- **Verification:** Focused CLI session-isolation tests and the broader coding-agent focused run passed; the subsequent authoritative aggregate coverage gate passed.
- **Prevention/follow-up:** Keep subprocess test deadlines distinct from production request timeouts and compare focused versus aggregate timings before changing runtime behavior.
- **Reusable learning:** Real CLI subprocess tests need an instrumentation-aware finite margin; aggregate coverage can multiply startup and teardown cost without indicating a product regression.
- **References:** `packages/coding-agent/test/session-isolation-cli.test.ts`.
