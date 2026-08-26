# 2026-08-26 — Repair protocols must bound semantic progress

- **Status:** Resolved
- **Task/context:** Diagnosing a requirement-definition benchmark that consumed hundreds of thousands of tokens while repeatedly repairing one rejected batch.
- **Unexpected observation or failure:** The agent could replay a complete definition that was semantically unchanged, or grow a repair lineage without improving deterministic diagnostics, while each rejection returned another large recovery payload.
- **Evidence:** The task-3 `5.0.1-rc.42` run timed out after 398,391 tokens and 24 tool calls. Focused tests reproduced canonical no-op repairs, non-improving overflow candidates, repeated foreign fields, and stale cross-cycle lineage expectations.
- **Approaches tried:**
  - **Attempt:** Permit repeated full-batch definitions and rely on prompt guidance to converge.
    - **Outcome:** Did not work
    - **Why:** Guidance did not provide a controller-enforced progress measure, and replayed payloads amplified token cost.
  - **Attempt:** Keep the active batch controller-side, canonicalize semantic equality, validate overflow only for strict diagnostic improvement, count unproductive attempts, and return compact repair feedback with explicit status recovery.
    - **Outcome:** Worked
    - **Why:** Every retry now has a bounded state transition and unchanged or regressive candidates cannot rotate the draft or reopen unbounded growth.
- **Root cause:** The protocol bounded individual payload shape but did not bound semantic non-progress across retries, and its recovery response repeatedly serialized more state than a sparse repair needed.
- **Resolution:** Add semantic no-op detection, historical diagnostic minima, bounded stagnation recovery, strict-improvement overflow adoption, compact feedback, and controller-owned full-batch recovery through status.
- **Verification:** Bounded-repair, repair-lineage, cross-cycle stagnation, next-action, and action-field tests verify draft identity, attempt thresholds, diagnostic improvement, and recovery behavior.
- **Prevention/follow-up:** Any iterative AI repair protocol must test semantic no-ops and cumulative progress, not only per-call size. Re-run the randomized paired benchmark before release.
- **Reusable learning:** A repair loop is bounded only when the controller measures semantic progress across attempts and has a finite, explicit recovery transition.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-repair.ts`, `packages/coding-agent/src/core/task-verification/requirement-definition-repair-candidate.ts`, `packages/coding-agent/test/task-requirement-definition-bounded-repair.test.ts`
