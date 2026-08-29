# 2026-08-26 — Requirement policy needs authoritative input

- **Status:** Resolved
- **Task/context:** Require a complete atomic requirement definition before the first implementation mutation.
- **Unexpected observation or failure:** The full unit gate produced 41 failures because promptless internal controllers were ordered to define a synthetic fallback task summary.
- **Evidence:** Fresh revision-zero harnesses had no captured user prompt or referenced source, yet the mutation gate rendered `Implement the requested workspace change` as authoritative input; a focused promptless regression reproduced it.
- **Approaches tried:**
  - **Attempt:** Migrate every legacy shell and test-authoring case to submit a fabricated definition.
    - **Outcome:** Did not work
    - **Why:** It would encode synthetic harness metadata as user authority and hide the activation bug.
  - **Attempt:** Centralize policy activation around persisted policy state or actual captured prompt/source authority.
    - **Outcome:** Worked
    - **Why:** Real user and restored task contexts remain fail-closed, while promptless internal tasks follow their original baseline and mutation gates.
- **Root cause:** Three controller paths independently treated `mutationRevision === 0` as sufficient authority to require definition, conflating lifecycle position with the existence of user requirements.
- **Resolution:** A shared policy predicate now requires the persisted marker or revision-zero authoritative prompt/context/source data; explicit definition still requires a declared task.
- **Verification:** Direct-prompt, restored-context, promptless, requirement-validation, and affected 70-file aggregate tests pass together.
- **Prevention/follow-up:** Reuse the shared predicate in every gate, status, and definition-context path; never infer requirement authority from a synthesized task summary.
- **Reusable learning:** Lifecycle phase can decide when to enforce requirements, but only authoritative captured input can decide whether requirements exist.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-policy.ts`
