# 2026-08-31 — Non-actionable guidance needs tool enforcement

- **Status:** Resolved
- **Task/context:** Bound one-item repair prompts without authorizing a guessed repair when the exact selected item cannot fit.
- **Unexpected observation or failure:** Status correctly said `next_required_action: status` and `Do not submit a repair`, but the requirement-audit tool still accepted and applied a remembered `repair_definition` because source identity itself was resolved.
- **Evidence:** The regression submits the otherwise valid selected Requirement 2 repair after the prompt crosses its hard byte limit. Before the fix, `applyRequirementAudit` ran; afterward it is not called, the draft and revision remain unchanged, and direct plus compacted guidance both require status.
- **Approaches tried:**
  - **Attempt:** Express the safety boundary only in model-facing prompt text.
    - **Outcome:** Did not work
    - **Why:** Guidance is not an authorization boundary and can be ignored, truncated, or recalled incorrectly.
  - **Attempt:** Derive one controller-owned `repairActionable` decision from the exact rendered prompt and enforce it before candidate construction or apply.
    - **Outcome:** Worked
    - **Why:** Prompt, tool execution, and compaction now share the same size and identity decision.
- **Root cause:** The renderer knew the target was too large to expose safely, but the mutation path checked only whether source identity existed.
- **Resolution:** Rejected-definition prompt rendering reports repair actionability. The requirement-audit tool rejects non-actionable repairs before apply, and compaction emits the same retrieval-only status boundary.
- **Verification:** The bounded-status regression proves no apply call, unchanged draft identity and revision, and consistent direct/context-extract next actions. The complete requirement-verification family passes 118 files and 1,047 tests.
- **Prevention/follow-up:** Every model-facing non-actionable state must be represented and enforced in the authoritative mutation path, not only in prose.
- **Reusable learning:** Safety guidance is descriptive; only a controller-enforced authorization predicate is protective.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-prompt.ts`, `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts`, `packages/coding-agent/test/task-requirement-definition-repair-bounded-status.test.ts`
