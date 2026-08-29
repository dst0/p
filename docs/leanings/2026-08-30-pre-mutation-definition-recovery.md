# 2026-08-30 — Pre-mutation definition recovery

- **Status:** Resolved
- **Task/context:** Prove that prompt-only and referenced-source tasks receive the same rejected-definition revision and sparse-repair path before implementation.
- **Unexpected observation or failure:** A live prompt-only canary received deterministic definition diagnostics but no `definition_revision`, so the model could not call `repair_definition` and fell back to a complete `define` call.
- **Evidence:** The source-free task remained in requirement-audit status `pending` during its rejected first definition. Rejected-draft capture additionally required `awaiting_definition`, while the validator's structured diagnostic count already uniquely identified a rejected definition candidate.
- **Approaches tried:**
  - **Attempt:** Treat the live failure as model non-compliance.
    - **Outcome:** Did not work
    - **Why:** The tool result contained no revision, so the requested repair call was impossible by protocol.
  - **Attempt:** Gate rejected-draft capture on structured validator diagnostics rather than lifecycle status.
    - **Outcome:** Worked
    - **Why:** Non-validator rejections do not carry `requirementDefinitionDiagnosticCount`, so they still cannot create or rotate a draft.
- **Root cause:** Draft capture coupled semantic validator output to one lifecycle state that referenced-source and post-mutation flows use, excluding valid prompt-only pre-mutation rejections.
- **Resolution:** Remove the redundant `awaiting_definition` condition while retaining the `needs_action`, structured-diagnostic, and repaired-candidate guards.
- **Verification:** A failing prompt-only regression now passes, and all requirement-audit tests pass without allowing non-validator failures to create drafts.
- **Prevention/follow-up:** Test each semantic transition from every valid lifecycle phase; do not use a phase label as a safety discriminant when a narrower result-specific discriminant exists.
- **Reusable learning:** State-machine recovery must be keyed to the semantic result that needs recovery, not to one incidental phase used by only some task shapes.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts`, `packages/coding-agent/test/task-requirement-definition-pre-mutation-repair.test.ts`
