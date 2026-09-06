# 2026-09-06 — Consumed numbers must not be reparsed as qualifiers

- **Status:** Resolved
- **Task/context:** Expand the decimal-equivalence regression after correcting asymmetric quantity normalization.
- **Unexpected observation or failure:** A timeout of `exactly one point five zero seconds` still produced an invented upper bound of zero seconds.
- **Evidence:** With decimal normalization fixed but the qualifier cursor unchanged, the parent independently reproduced three failures for trailing-zero, all-zero, and internal-zero decimals. `strictSemanticQualifierGaps` reported an extra `upper-bound` with value `0` and anchor `seconds`.
- **Approaches tried:**
  - **Attempt:** Normalize decimal values only.
    - **Outcome:** Partial
    - **Why:** The scanner revisited the `zero` token that the number parser had already consumed and treated it as another prohibition.
  - **Attempt:** Advance the qualifier cursor through the consumed cardinality span.
    - **Outcome:** Worked
    - **Why:** Numeric tokens are classified once, while later independent constraints remain visible to the scanner.
- **Root cause:** `bindingsWithinLine` advanced only through the qualifier keyword, ignoring `semanticCardinalityAfter`'s end position.
- **Resolution:** Advance to the greater of the qualifier end and consumed cardinality end. Do not globally suppress zero-valued constraints.
- **Verification:** The decimal-equivalence suite passes and separately requires a same-sentence `zero duplicate attempts` constraint after the decimal timeout. Omitting that constraint reports its exact gap; replacing it with an upper bound of one still fails. The implementation's focused ten-suite run passed 100 tests; full coverage and remote CI are separate gates.
- **Prevention/follow-up:** Parser layers must respect consumed spans. Pair overlap regressions with a following independent constraint to detect accidental overconsumption.
- **Reusable learning:** A token owned by one parsed semantic unit must not acquire a second conflicting meaning during the same scan.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/semantic-qualifier-coverage.ts`; `packages/coding-agent/test/task-requirement-audit-cardinality-equivalence.test.ts`; `packages/coding-agent/docs/usage.md`; `2026-09-06-word-decimals-need-canonical-quantity-identity.md`.
