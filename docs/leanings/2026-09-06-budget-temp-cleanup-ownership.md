# 2026-09-06 — Atomic-write cleanup must own the temporary file

- **Status:** Resolved
- **Task/context:** Atomic budget ledger writes.
- **Unexpected observation or failure:** A failed temporary-file open was masked by an unlink error during cleanup.
- **Evidence:** A filesystem filename-length regression raised the wrong exception before the fix.
- **Approaches tried:**
  - **Attempt:** Always unlink the generated temporary path in finally.
    - **Outcome:** Did not work
    - **Why:** Generating a pathname does not prove this transaction created its file.
- **Root cause:** Cleanup tracked a name but not successful exclusive creation.
- **Resolution:** Unlink only after this transaction's `wx` open succeeded.
- **Verification:** The filename-length failure remains a typed budget storage error; storage recovery tests pass.
- **Prevention/follow-up:** Preserve exclusive-create ownership in future atomic-file utilities.
- **Reusable learning:** Cleanup authority comes from successful resource acquisition, not an intended path.
- **References:** `packages/coding-agent/test/run-budget-storage-recovery.test.ts`.
