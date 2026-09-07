# 2026-09-02 — Negative readbacks need receipt bindings

- **Status:** Partial
- **Task/context:** Make external-effect evidence remain correct across multiple receipts, connectors, and later remote-state changes.
- **Unexpected observation or failure:** A later successful-negative or errored readback could not supersede an earlier confirmation because unconfirmed results carried no receipt-and-criterion identity. Composed hooks could also return raw provider details after the controller sanitized native details.
- **Evidence:** Failing-first regressions reused an old verification token after receipt-bound negative reads and observed raw provider fields in the final composed-hook result.
- **Approaches tried:**
  - **Attempt:** Treat every later read in the same tool/domain as superseding.
    - **Outcome:** Did not work
    - **Why:** Independent effects through the same connector displaced one another.
  - **Attempt:** Bind both positive and negative outcomes to receipt ID, criterion hash, and effect domain.
    - **Outcome:** Worked
    - **Why:** `confirmed` can prove readiness, while `not_confirmed` identifies exactly which prior proof to invalidate without proving success.
- **Root cause:** Proof eligibility and proof identity were represented by the same optional fields, and prior-hook details were preferred over the sanitized native snapshot.
- **Resolution:** Persist bounded `confirmed | not_confirmed` bindings, scope supersession by receipt and criterion rather than read-tool name, keep independent receipts current, and return only sanitized native proof details.
- **Verification:** Negative supersession, two-receipt concurrency, criterion mismatch, status recovery, and composed-hook sanitization regressions pass; full repository and live verification remain pending.
- **Prevention/follow-up:** Require negative connector outcomes to carry the same bounded binding fields as confirmations and test real hook composition.
- **Reusable learning:** A negative observation can invalidate safely only when it carries the same immutable identity as the positive proof it supersedes.
- **References:** `packages/coding-agent/test/task-verification-negative-readback-supersession.test.ts`, `packages/coding-agent/test/task-verification-composed-hook-readback-sanitization.test.ts`
