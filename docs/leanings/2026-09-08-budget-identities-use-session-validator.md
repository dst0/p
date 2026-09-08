# 2026-09-08 — Budget identities reuse the session validator

- **Status:** Resolved
- **Task/context:** Bind persisted task-budget filenames to custom session identities.
- **Unexpected observation or failure:** The budget layer accepted fewer IDs than `SessionManager`, rejecting valid legacy IDs containing interior `_` or `.`.
- **Evidence:** `abc-123_def.456` passed canonical session creation but failed budget construction with `budget_storage_error`.
- **Approaches tried:**
  - **Attempt:** Maintain a second simplified budget-ID regular expression.
    - **Outcome:** Did not work
    - **Why:** The duplicate grammar drifted from the authoritative session contract.
  - **Attempt:** Reuse `assertValidSessionId` and translate its failure to the typed budget storage error.
    - **Outcome:** Worked
    - **Why:** Validity and filename safety now have one source of truth.
- **Root cause:** Storage code duplicated identity validation instead of consuming the owning domain's validator.
- **Resolution:** Budget scope validation delegates to the canonical session-ID validator before constructing the sidecar filename.
- **Verification:** Budget regressions accept `abc-123_def.456` and reject traversal, separators, and invalid edge punctuation.
- **Prevention/follow-up:** Derived storage identifiers must reuse the source entity's canonical validator or filename-safe encoder.
- **Reusable learning:** Do not narrow or duplicate an upstream identity grammar in a sidecar subsystem.
- **References:** `packages/coding-agent/src/core/session-manager/session-id.ts`, `packages/coding-agent/src/core/run-budget/session-run-budget.ts`
