# 2026-08-28 — Qdrant recovery budgets must cover persisted storage

- **Status:** Resolved
- **Task/context:** Restore reliable indexing-service startup with an existing multi-gigabyte local Qdrant database.
- **Unexpected observation or failure:** The daemon repeatedly restarted Qdrant after a short readiness deadline even though Qdrant was still recovering persisted collections.
- **Evidence:** A delayed-health regression stays alive beyond 30 seconds and becomes ready later; a separate fake-timer regression reproduced health polling continuing after startup had already failed. The exact installed service recovered 40 persisted collections and became Qdrant-ready in about four and a half minutes without a restart loop.
- **Approaches tried:**
  - **Attempt:** Treat the original readiness timeout as proof that Qdrant was dead.
    - **Outcome:** Did not work.
    - **Why:** Recovery duration grows with persisted state and can exceed a fresh-database startup budget.
  - **Attempt:** Increase only the outer installer wait.
    - **Outcome:** Partial.
    - **Why:** The daemon's inner startup watchdog could still restart Qdrant first.
- **Root cause:** Startup budgets were inconsistent and too short for persisted recovery; an async health probe could also reschedule after the startup promise settled.
- **Resolution:** Use one configurable five-minute Qdrant startup budget through config, daemon, and installer health allowance, and guard health polling before and after its await.
- **Verification:** Focused slow-recovery and settled-poll regressions pass; the exact installed runtime completed persisted recovery, service readiness, and the real semantic-search smoke.
- **Prevention/follow-up:** Keep inner backend and outer installer deadlines derived from the same configuration and retain delayed-health plus settlement tests.
- **Reusable learning:** A process that is recovering durable state is not failed merely because it exceeds a fresh-start timeout; all supervising deadlines must agree.
- **References:** `packages/code-index/test/qdrant-slow-recovery.test.ts`, `packages/code-index/test/qdrant-startup-poll-settlement.test.ts`, `docs/leanings/2026-08-28-reinstall-readiness-can-fail-during-qdrant-recovery.md`
