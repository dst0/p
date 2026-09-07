# 2026-09-06 — Admission wrappers must preserve cancellation

- **Status:** Resolved
- **Task/context:** Adversarial AGY review of model-call admission.
- **Unexpected observation or failure:** A provider throwing during cancellation produced an error terminal state instead of aborted.
- **Evidence:** Both synchronous dispatch-abort and async iterator-abort regressions failed with `error` instead of `aborted`.
- **Approaches tried:**
  - **Attempt:** Special-case only pre-aborted requests.
    - **Outcome:** Did not work
    - **Why:** Cancellation can happen after admission or after partial output.
- **Root cause:** Exception forwarding defaulted to an ordinary error without rechecking the signal.
- **Resolution:** Preserve the active abort signal at both exception boundaries while settling the admitted request once.
- **Verification:** Both regressions pass; partial content remains available and unknown usage is settled once.
- **Prevention/follow-up:** Keep dispatch and mid-stream abort cases in the admission suite.
- **Reusable learning:** A cross-cutting wrapper must preserve cancellation semantics, not just successful results.
- **References:** `packages/ai/test/model-call-admission.test.ts`.
