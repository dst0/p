# 2026-09-01 — Failed benchmark evidence needs action identity

- **Status:** Resolved
- **Task/context:** Diagnose a compiled project-instruction benchmark whose inner workload passed but whose outer evidence validator rejected the result.
- **Unexpected observation or failure:** Two expensive live replays ended with the same generic `completed mutating action had no authoritative rule batch` diagnostic, while cleanup correctly removed the failed cell scratch recording.
- **Evidence:** The retained public evidence identified the failing invariant but not the tool call that violated it. The progress archive exposed only aggregate mutation counts, so neither artifact could distinguish classification drift from a runtime gate defect after cleanup.
- **Approaches tried:**
  - **Attempt:** Infer the culprit from separately maintained safe-tool and verification-control-plane sets.
    - **Outcome:** Did not work
    - **Why:** The sets were already aligned, and the generic error did not identify which completed action entered benchmark evidence without a runtime block.
  - **Attempt:** Add a bounded action identity to the invariant failure.
    - **Outcome:** Worked
    - **Why:** The validator reduces the projected tool name through a fixed parent-owned allowlist and combines the result with its numeric event ordinal, preserving decisive identity without retaining arguments, source text, or the scratch recording.
- **Root cause:** The validator discarded the identity of the action it had already isolated, making normal failed-cell cleanup erase the decisive diagnostic evidence.
- **Resolution:** Include an allowlisted built-in tool category and numeric event ordinal in the missing-authoritative-batch failure. Unknown, custom, hostile, or missing names are reported as `custom` rather than copied into reports.
- **Verification:** A regression reproduces the former generic error and proves the diagnostic now returns `tool=record_learning, event=42`.
- **Prevention/follow-up:** Every expensive benchmark invariant should report the smallest sanitized identity needed to reproduce its failure before scratch evidence is cleaned.
- **Reusable learning:** Preserve decisive, bounded failure identity at the point an invariant fails; aggregate telemetry cannot recover it later.
- **References:** `benchmarks/src/project-instructions/routed-turn-validation.ts`, `benchmarks/test/project-instructions/routed-turn-diagnostics.test.ts`
