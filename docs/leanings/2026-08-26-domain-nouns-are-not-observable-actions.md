# 2026-08-26 — Domain nouns are not observable actions

- **Status:** Resolved
- **Task/context:** Proving the requirement-definition workflow with a live non-coding operational handoff canary.
- **Unexpected observation or failure:** A single constraint, “never alter audit history,” was repeatedly rejected as compound; after that was fixed, a static JSON field named `rollback` incorrectly triggered failed-operation state and event-log proof obligations.
- **Evidence:** The atomicity heuristic counted both `preserves` and the noun modifier `audit` as separate observable outcomes. The proof-policy heuristic then treated the static `Rollback:` label as a failure event and demanded before/after code-test witnesses for the field's `state` and `audit history` text.
- **Approaches tried:**
  - **Attempt:** Rely on the model to paraphrase or split the already-atomic negative constraint.
    - **Outcome:** Did not work
    - **Why:** No semantically faithful split exists, so retries only changed wording and consumed context.
  - **Attempt:** Distinguish conjugated or determiner-led audit actions from noun phrases such as `audit history` and `audit log`.
    - **Outcome:** Worked
    - **Why:** The heuristic still recognizes observable auditing actions without turning domain nouns into extra outcomes.
- **Root cause:** Lexical safety heuristics accepted bare `audit` as an action and bare `rollback` as a failure signal without checking their grammatical or operational roles.
- **Resolution:** Count only action-shaped audit phrases, and derive failure-preservation proofs only from an explicit failure signal, atomicity statement, or action-shaped rollback operation.
- **Verification:** Exact live regressions for the audit-history constraint and static rollback field pass with the atomicity, requirement-audit validation, universal list-group, and proof-policy suites.
- **Prevention/follow-up:** Add non-coding canaries and noun-versus-verb counterexamples whenever a lexical safety heuristic expands.
- **Reusable learning:** Lexical validators must prove an action role before counting a domain word as an independent observable outcome.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-atomicity.ts`, `packages/coding-agent/src/core/task-verification/requirement-derived-boundaries.ts`, `packages/coding-agent/test/task-requirement-definition-atomicity.test.ts`, `packages/coding-agent/test/task-requirement-audit-proof-policy-direct-isolation.test.ts`
