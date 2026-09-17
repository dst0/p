# 2026-09-09 — Budget ledger directories require parent fsync

- **Status:** Resolved
- **Task/context:** Persist first-use task-budget accounting so a crash cannot re-admit previously spent work.
- **Unexpected observation or failure:** Budget records fsynced their file and `.budgets` directory, but recursive creation of `.budgets` never fsynced the existing session directory that made it reachable.
- **Evidence:** An operation-order regression observed no parent open/fsync before the first budget record publication.
- **Approaches tried:**
  - **Attempt:** Treat the final `.budgets` fsync as sufficient.
    - **Outcome:** Did not work
    - **Why:** It flushes entries inside `.budgets`, not the `.budgets` entry stored in its parent.
  - **Attempt:** Reuse the durable directory creator with mode `0700` before acquiring the budget lock and publishing the record.
    - **Outcome:** Worked
    - **Why:** The private directory retains its permissions and becomes durably reachable before ledger mutation.
- **Root cause:** Budget record durability omitted the parent-directory boundary used during first creation.
- **Resolution:** First-use budget storage creates `.budgets` one component at a time and fsyncs each existing parent while preserving private mode.
- **Verification:** `run-budget-storage-recovery.test.ts` asserts mkdir `.budgets`, open session parent, and parent fsync ordering before update publication.
- **Prevention/follow-up:** Apply the same directory-reachability protocol to every durable sidecar store, not only primary session files.
- **Reusable learning:** A durable ledger can enforce limits after crash only when both its record and the directory path leading to it are durable.
- **References:** `packages/coding-agent/src/core/run-budget/state-storage.ts`, `packages/coding-agent/src/core/session-manager/session-file-durability.ts`, `packages/coding-agent/test/run-budget-storage-recovery.test.ts`
