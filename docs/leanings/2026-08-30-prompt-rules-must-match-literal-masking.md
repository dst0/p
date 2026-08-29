# 2026-08-30 — Prompt rules must match literal masking

- **Status:** Resolved
- **Task/context:** Clarify first-pass high-risk requirement atomicity without contradicting exact source preservation.
- **Unexpected observation or failure:** Prompt guidance forbade all semicolons while also requiring exact backticked identifiers and verbatim facet propositions. The validator intentionally masks scalar literals before treating semicolons as structural separators.
- **Evidence:** A valid source literal such as `` `type;a` `` must remain exact and does not trigger the validator, but the unqualified prompt rule told the model to remove or split it.
- **Approaches tried:**
  - **Attempt:** State the validator's structural punctuation rule as a blanket punctuation ban.
    - **Outcome:** Did not work
    - **Why:** The concise wording erased the validator's quoted-literal exception and conflicted with source fidelity.
  - **Attempt:** Qualify the rule as applying only to structural semicolons outside exact quoted or backticked literals.
    - **Outcome:** Worked
    - **Why:** It preserves literal identity while still guiding one-outcome acceptance criteria.
- **Root cause:** Prompt simplification described the validator's post-masking check as though it operated on raw source text.
- **Resolution:** The prompt now names the literal exception explicitly and retains exact semicolon-bearing source text.
- **Verification:** Prompt rendering and atomicity tests pass for exact semicolon-bearing literals, structural atomicity, facets, and identifier preservation.
- **Prevention/follow-up:** Derive prompt constraints from the validator's actual normalization order, including masking and canonicalization exceptions.
- **Reusable learning:** A model-facing validation rule must describe what the validator evaluates after normalization, not an overbroad approximation of the raw syntax.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-prompt.ts`, `packages/coding-agent/src/core/task-verification/requirement-definition-atomicity.ts`, `packages/coding-agent/test/task-requirement-definition-prompt.test.ts`
