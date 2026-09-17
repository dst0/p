# 2026-09-16 - Reversible extension suspension during session replacement

- **Status:** Resolved
- **Task/context:** Release hardening of session replacement and rollback.
- **Unexpected observation or failure:** Regression 2860 showed that captured old extension contexts remained usable during provisional replacement.
- **Evidence:** The regression failed before suspension; focused lifecycle and route tests subsequently passed 14/14 on 2026-09-16.
- **Approaches tried:**
  - **Attempt:** Dispose the previous runtime before replacement callbacks.
    - **Outcome:** Did not work
    - **Why:** Permanent invalidation prevents rollback from restoring the previous runtime.
  - **Attempt:** Suspend the previous runner and runtime assertion until replacement commits or rolls back.
    - **Outcome:** Worked
    - **Why:** Rollback restores access; successful replacement retains permanent disposal.
- **Root cause:** Shutdown notification does not revoke captured handles, but permanent disposal occurs only after provisional callbacks finish.
- **Resolution:** Suspend before applying the replacement, resume before rollback rebind, and retain permanent invalidation on success.
- **Verification:** Extension runner suspension, runtime transaction, regression 2860, and queued route tests passed with exit code 0.
- **Prevention/follow-up:** Retain captured-handle regressions and independently verify restored API mutations and rollback failure reporting.
- **Reusable learning:** Transactional replacement needs reversible access revocation distinct from final resource disposal.
- **References:** `packages/coding-agent/src/core/session-runtime-replacement.ts`; `packages/coding-agent/test/extension-runner-suspension.test.ts`; `docs/leanings/2026-09-09-session-replacement-rollback-lifecycle.md`.
