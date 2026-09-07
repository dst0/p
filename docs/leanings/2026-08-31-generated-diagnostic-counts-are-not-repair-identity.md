# 2026-08-31 — Generated diagnostic counts are not repair identity

- **Status:** Resolved
- **Task/context:** Preserve one-item requirement-repair progress when repeated diagnostics are size-bounded and grouped.
- **Unexpected observation or failure:** A concrete diagnostic remained unchanged while its generated trailing `[N instances]` count changed. The controller compared the whole rendered line and incorrectly treated the selected defect as resolved.
- **Evidence:** A focused regression selects `Requirement 8: Invalid provenance. [34 instances]` and rechecks the same diagnostic with 12 instances and without aggregation metadata; both must remain the same target.
- **Approaches tried:**
  - **Attempt:** Compare complete human-readable diagnostic lines.
    - **Outcome:** Did not work
    - **Why:** Presentation metadata changes independently of the semantic defect.
  - **Attempt:** Remove only the controller-generated trailing count before target selection and comparison.
    - **Outcome:** Worked
    - **Why:** The exact concrete diagnostic remains stable while unrelated aggregation changes are ignored.
- **Root cause:** Repair identity included a lossy presentation-layer count rather than only the controller-owned semantic diagnostic.
- **Resolution:** Target extraction and later numbered-diagnostic comparison strip only the generated terminal `[N instance(s)]` suffix.
- **Verification:** `task-requirement-repair-diagnostic-identity.test.ts` passes for changed and absent count metadata; the complete requirement-verification family passes 118 files and 1,047 tests.
- **Prevention/follow-up:** Keep counts, truncation markers, and grouping summaries outside semantic IDs and progress comparisons.
- **Reusable learning:** Presentation metadata may describe a repair target, but it must never become part of that target's identity.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-repair-target.ts`, `packages/coding-agent/test/task-requirement-repair-diagnostic-identity.test.ts`
