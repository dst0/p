# 2026-09-06 — Budget scope must precede resource initialization

- **Status:** Resolved
- **Task/context:** First-use task budgets for CLI and SDK sessions.
- **Unexpected observation or failure:** Resource-loading model calls were unaccounted; a second in-memory controller saw zero spend.
- **Evidence:** Regression tests observed missing admission during CLI/SDK initialization and expected one request but received zero after controller recreation.
- **Approaches tried:**
  - **Attempt:** Scope only the agent stream and instruction compiler.
    - **Outcome:** Did not work
    - **Why:** Extension initialization precedes both, and private controller maps lose ephemeral spend.
- **Root cause:** Accounting lifetime began after executable resources; ledger ownership was per controller rather than SessionManager.
- **Resolution:** Enter the budget scope before CLI resources and SDK-owned reload; share in-memory ledgers using weak SessionManager ownership.
- **Verification:** Failing regressions passed after the fix; persisted token/USD resume and session-switch tests also pass.
- **Prevention/follow-up:** Caller-initialized resource loaders remain explicitly caller-owned; test new initialization entrypoints.
- **Reusable learning:** Establish spend authority before the first executable hook, not just before the first user prompt.
- **References:** `packages/coding-agent/test/runtime-factory.test.ts`, `test/run-budget-sdk-initialization.test.ts`, `test/run-budget-session-scope.test.ts`.
