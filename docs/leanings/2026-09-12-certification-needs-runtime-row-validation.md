# 2026-09-12 — Certification needs runtime row validation

- **Status:** Resolved
- **Task/context:** Consuming benchmark result rows at the certification boundary.
- **Unexpected observation or failure:** TypeScript types did not prevent malformed runtime rows, including missing models and non-finite metrics, from reaching certification logic.
- **Evidence:** Wrong, missing, `NaN`, and infinite nested fields were accepted by the former semantic-only gates.
- **Approaches tried:**
  - **Attempt:** Rely on producer types and later aggregate comparisons.
    - **Outcome:** Did not work
    - **Why:** Runtime objects and deserialized data can violate compile-time declarations.
  - **Attempt:** Validate every row and nested metric before semantic certification.
    - **Outcome:** Worked
    - **Why:** Invalid evidence produces explicit field failures and cannot be certified.
- **Root cause:** The certification boundary lacked a runtime schema contract.
- **Resolution:** Rows now require valid identity, lifecycle, usage, cost, and internally consistent quality shapes, including task-bound maximum scores, score/raw-score/penalty relationships, positive total tokens, and finite elapsed values.
- **Verification:** `certification-row-schema.test.ts` covers valid evidence and malformed nested permutations.
- **Prevention/follow-up:** Extend the runtime validator in the same change whenever the certified result schema evolves.
- **Reusable learning:** Static types do not validate evidence; certification boundaries need exhaustive runtime schemas.
- **References:** `benchmarks/test/workloads/certification-row-schema.test.ts`
