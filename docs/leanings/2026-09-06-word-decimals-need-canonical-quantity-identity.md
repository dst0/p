# 2026-09-06 — Word decimals need canonical quantity identity

- **Status:** Resolved
- **Task/context:** Review the compiled-instruction and evidence-verification release against the changed-line coverage gate.
- **Unexpected observation or failure:** Equivalent word and digit decimal requirements could be rejected as different quantities, causing unnecessary semantic repair.
- **Evidence:** A failing regression on `9777e392c1e361844518fb4f7e7a1f59c1a4ab76` compared `one point five zero` with `1.5`. The parent independently reproduced the failure before the fix. The final domain fixture uses timeout seconds rather than a fractional record count.
- **Approaches tried:**
  - **Attempt:** Compare the word parser's assembled decimal string with the existing normalized digit literal.
    - **Outcome:** Did not work
    - **Why:** The word form retained insignificant trailing zeros while the digit form removed them.
  - **Attempt:** Route assembled word decimals through the existing exact string-based digit normalizer.
    - **Outcome:** Worked
    - **Why:** Both presentations now share quantity identity without introducing floating-point rounding or relaxing unit and currency checks.
- **Root cause:** `wordDecimal` bypassed `normalizedDigitLiteral`, so presentation differences survived on only one side of the comparison.
- **Resolution:** Normalize the assembled word decimal through the same literal path. Keep significant internal fractional zeros and preserve existing distinct-value, unit, currency, and exponent boundaries.
- **Verification:** `task-requirement-audit-cardinality-equivalence.test.ts` covers trailing-zero, all-zero, internal-zero, different-value, unit, currency, and exponent cases. The implementation's focused ten-suite run passed 100 tests. Full coverage, installation, and remote CI remain independent delivery gates.
- **Prevention/follow-up:** All supported quantity representations must use one canonicalization contract. Test both equivalent presentations and nearby unequal values.
- **Reusable learning:** Normalize semantic quantity identity consistently before comparing representations; do not rely on a model to repair a deterministic presentation mismatch.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/semantic-cardinality.ts`; `packages/coding-agent/test/task-requirement-audit-cardinality-equivalence.test.ts`; `packages/coding-agent/docs/usage.md`; `2026-09-06-consumed-numbers-must-not-be-reparsed-as-qualifiers.md`.
