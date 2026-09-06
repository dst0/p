# 2026-09-06 — Structured output must preserve failure exit status

- **Status:** Resolved
- **Task/context:** Headless budget exhaustion and print mode.
- **Unexpected observation or failure:** JSON mode could return exit status zero after a terminal model error or abort.
- **Evidence:** The initial domain regression failed two error cases while successful completion passed.
- **Approaches tried:**
  - **Attempt:** Keep terminal-state handling inside the text-only output branch.
    - **Outcome:** Did not work
    - **Why:** JSON automation then missed the failure status even though the response contained an error.
- **Root cause:** Formatting mode controlled outcome semantics.
- **Resolution:** Determine terminal error/abort status independently of text rendering.
- **Verification:** Error, abort, and successful JSON outcomes pass in `run-budget-print-outcome.test.ts`.
- **Prevention/follow-up:** Verify both structured content and process outcome in CLI regressions.
- **Reusable learning:** Serialization format must not change success/failure semantics.
- **References:** `packages/coding-agent/test/run-budget-print-outcome.test.ts`.
