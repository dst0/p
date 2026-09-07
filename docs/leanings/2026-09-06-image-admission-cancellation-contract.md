# 2026-09-06 — Image admission must retain structured cancellation

- **Status:** Resolved
- **Task/context:** Budget-aware image generation.
- **Unexpected observation or failure:** The full unit suite caught a pre-aborted image call throwing instead of returning its established aborted result.
- **Evidence:** The existing `openrouter-images.test.ts` cancellation regression failed; the new focused test had incorrectly asserted the changed exception behavior.
- **Approaches tried:**
  - **Attempt:** Throw immediately before admission for an already-aborted signal.
    - **Outcome:** Did not work
    - **Why:** Zero dispatch was correct, but the public structured-result contract was not preserved.
- **Root cause:** A new cross-cutting guard changed existing error semantics, and a narrow new test encoded that mistake.
- **Resolution:** Return an aborted image result with zero usage and no provider dispatch or receipt admission.
- **Verification:** Existing provider cancellation and dedicated image admission tests reproduce the defect and pass after the fix.
- **Prevention/follow-up:** Run existing provider tests alongside new guard tests and keep the full suite as an independent gate.
- **Reusable learning:** New feature tests must not redefine an established API contract by accident.
- **References:** `packages/ai/test/openrouter-images.test.ts`, `packages/ai/test/image-call-admission.test.ts`.
