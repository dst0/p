# 2026-09-06 — Missing observed budget state must fail closed

- **Status:** Resolved
- **Task/context:** Durable task budget recovery.
- **Unexpected observation or failure:** Deleting a previously observed ledger could recreate zero spend.
- **Evidence:** A regression removed a persisted ledger and expected `budget_storage_error` before further admission.
- **Approaches tried:**
  - **Attempt:** Treat all ENOENT reads as initial empty state.
    - **Outcome:** Did not work
    - **Why:** A missing initial ledger and missing durable spend are different states.
- **Root cause:** Storage did not remember whether durable state had already been observed.
- **Resolution:** Permit absent files only before the first successful read/write; later loss fails closed.
- **Verification:** The deletion regression and corrupt/pending-ledger recovery tests pass.
- **Prevention/follow-up:** Do not delete accounting records as a repair procedure.
- **Reusable learning:** Absence after persistence is data loss, not permission to reset a quota.
- **References:** `packages/coding-agent/test/run-budget-storage-recovery.test.ts`.
