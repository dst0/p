# 2026-09-21 — Child-process timeout aggregate-suite follow-up

- **Status:** Partial
- **Task/context:** Verifying the startup-session child-process timeout adjustment before the `5.0.1` release transaction.
- **Unexpected observation or failure:** The focused startup-session file passes with the 60-second child watchdog and 90-second Vitest file timeout, but the aggregate workspace suite still has unrelated 30-second test-timeout failures under concurrent machine load.
- **Evidence:** Focused run: 2 tests passed in about 63 seconds. The aggregate run recorded timeout failures in `stdout-cleanliness`, `session-id-readonly`, and a typecheck-authority case before it was interrupted; its original startup test also failed at the former 30-second Vitest deadline.
- **Approaches tried:**
  - **Attempt:** Raised only the child watchdog from 20 to 60 seconds.
    - **Outcome:** Partial
    - **Why:** It did not override Vitest's separate 30-second per-test deadline.
  - **Attempt:** Added a 90-second timeout to the startup-session test group while retaining the 60-second kill watchdog.
    - **Outcome:** Worked for the focused test
    - **Why:** The focused file completed both assertions without masking a killed child; aggregate proof remains pending because other files still hit their own deadlines under load.
- **Root cause:** The repository's aggregate Vitest run is sensitive to concurrent CPU load, and per-test deadlines are independent from child-process watchdogs.
- **Resolution:** Keep the explicit 60/90-second startup-session limits and treat a green aggregate rerun under controlled load as a release prerequisite.
- **Verification:** Scoped five-file regression run passed 32 tests; `npm run check` passed. Aggregate workspace evidence is not green.
- **Prevention/follow-up:** Rerun `npm run test:unit` when competing heavy work has quiesced; do not claim a full-suite pass from focused results.
- **Reusable learning:** A focused subprocess test can be healthy while aggregate execution is resource-starved; record both signals separately and keep release claims fail-closed.
- **References:** `packages/coding-agent/test/startup-session-name.test.ts`, `/tmp/p-work3-full-test-20260921-114531.active.log.br`
