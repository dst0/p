# 2026-09-26 — Child timeout fixtures need full-suite load margin

- **Status:** Resolved
- **Task/context:** Run the complete p test gate after rebuilding the isolated worktree.
- **Unexpected observation or failure:** The Unix-socket descendant cleanup test failed because its grandchild readiness flag was absent when a 600 ms command deadline expired under full-suite load.
- **Evidence:** The focused test passed, but the post-build `./test.sh` run had exactly one failure in `scripts/bounded-process-command.test.js` while package suites passed. The helper must spawn a grandchild and establish a socket before the test can prove cleanup.
- **Approaches tried:**
  - **Attempt:** Retain the 600 ms deadline from the focused test.
    - **Outcome:** Did not work
    - **Why:** Full-suite scheduling sometimes consumed the readiness window before the grandchild was observable.
  - **Attempt:** Give the helper a 9-second readiness window and the bounded command a 10-second timeout, retaining assertions that the grandchild was alive and later gone.
    - **Outcome:** Worked
    - **Why:** Both the focused test and the containing full suite passed under load.
- **Root cause:** The fixture conflated fast local startup timing with the behavior under test: descendant termination after a timeout.
- **Resolution:** Increase only the fixture's startup margin while keeping the timeout and descendant-cleanup assertions.
- **Verification:** `node --test scripts/bounded-process-command.test.js` passed all eight tests; final `./test.sh` passed all 172 root script tests and all other suites.
- **Prevention/follow-up:** Require a measured full-suite load margin for child-process timeout fixtures and re-run the containing suite before publication.
- **Reusable learning:** Test process-tree cleanup after an established child state; do not make helper startup speed the invariant.
- **References:** `scripts/bounded-process-command.test.js`, `AGENTS.md`
