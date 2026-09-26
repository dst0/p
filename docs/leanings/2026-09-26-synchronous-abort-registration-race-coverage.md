# 2026-09-26 — Cover synchronous abort between check and listener registration

- **Status:** Resolved locally; CI rerun pending
- **Task/context:** Diagnose PR #153 changed-line coverage after local tests and the live P startup smoke passed.
- **Unexpected observation or failure:** CI passed every test suite but rejected 43/45 changed executable lines; two uncovered lines were the synchronous-abort guard in `compiler-runner.ts`.
- **Evidence:** The CI coverage report named `compiler-runner.ts:84-85` and 95.56% changed-line coverage against a 99% gate. Existing tests covered pre-aborted signals and later timeout, but not an abort raised inside the synchronous part of compiler invocation.
- **Approaches tried:**
  - **Attempt:** Treat the uncovered branch as an instrumentation artifact or add a superficial branch trigger.
    - **Outcome:** Did not work
    - **Why:** The branch protects a real race between the pre-call abort check and listener attachment.
  - **Attempt:** Add a custom compiler that synchronously aborts its parent before yielding one event-loop turn, then assert the attempt fails instead of accepting its late result.
    - **Outcome:** Worked locally
    - **Why:** The regression expresses the operational race; focused coverage recorded both formerly missed guard lines as executed.
- **Root cause:** Tests exercised cancellation before invocation and after async work, but omitted cancellation inside synchronous compiler setup.
- **Resolution:** Add a focused regression for the registration gap and retain the runtime guard unchanged.
- **Verification:** Focused test passed (3/3), focused LCOV recorded `compiler-runner.ts:84-85` as executed, and the full `./test.sh` passed (coding-agent 5,061 tests; TUI 768; benchmark 485; root scripts 172; release audit 85; other packages green). The primary auth file was restored with mode `0600`; closed test output was verified in Brotli Q6. CI rerun remains pending.
- **Prevention/follow-up:** Add this three-phase cancellation test rule to `AGENTS.md`; verify the changed-line coverage gate rather than bypassing it.
- **Reusable learning:** Cancellation coverage must include the synchronous gap between checking a signal and subscribing to it.
- **References:** `packages/coding-agent/test/project-instruction-compiler-deadline.test.ts`, `packages/coding-agent/src/core/project-instructions/compiler-runner.ts`, PR #153
