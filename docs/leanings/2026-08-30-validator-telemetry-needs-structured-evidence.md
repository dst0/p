# 2026-08-30 — Validator telemetry needs structured evidence

- **Status:** Resolved
- **Task/context:** Correct requirement-repair benchmark telemetry after a revision-bearing protocol error was reported as a newly rejected definition.
- **Unexpected observation or failure:** A `needs_action` response that retained the active draft echoed its `definition_revision`, causing telemetry to replace the current draft count and diagnostic lineage even though no candidate definition reached validation.
- **Evidence:** The rc.51 recording contained an action-field protocol error, while telemetry reported a new 50-requirement rejected draft. An adversarial regression reproduced the same false transition with a non-foreign `define` protocol error.
- **Approaches tried:**
  - **Attempt:** Exclude the observed foreign-field message with a regular expression.
    - **Outcome:** Partial
    - **Why:** Other pre-validation and lifecycle errors can also include the retained revision, so enumerating English messages cannot prove validator execution.
  - **Attempt:** Require the structured `requirementDefinitionDiagnosticCount` result field before classifying a rejection as an applied definition candidate.
    - **Outcome:** Worked
    - **Why:** The controller emits that field only for deterministic definition-validator rejections; protocol errors retain the previous lineage.
- **Root cause:** Telemetry inferred a semantic state transition from status text and revision presence instead of the controller's structured validator result.
- **Resolution:** Applied rejections now require a positive safe-integer structured diagnostic count. Revision-bearing errors without it remain `protocol_rejected`.
- **Verification:** Focused telemetry and revision-lineage tests pass, including non-foreign protocol errors, replay, unknown diagnostics, and accepted repair rotation; the complete benchmark test suite passes.
- **Prevention/follow-up:** Treat user-visible text as display data. Add structured discriminants for every telemetry transition and test protocol failures that deliberately reuse active-state identifiers.
- **Reusable learning:** Observability must consume the same structured semantic discriminator as the state machine; an echoed identifier does not prove a transition occurred.
- **References:** `benchmarks/src/project-instructions/run-repair-telemetry.ts`, `benchmarks/test/project-instructions/run-repair-telemetry.test.ts`, `benchmarks/test/project-instructions/run-repair-revision-lineage.test.ts`
