# 2026-08-31 — Dynamic tools require verification reconciliation

- **Status:** Resolved
- **Task/context:** Making task verification apply consistently to SDK sessions whose active tool set can change at runtime.
- **Unexpected observation or failure:** A session created with only read-only tools correctly started with verification dormant, but activating a hidden mutating custom tool did not activate verification. Conversely, removing tools could have disabled the gate after an effect was already recorded. A dormant configured mode could also start with implicit completion and later activate a mutator without a usable `finish_work` gate. Construction-time name validation additionally missed extensions that registered a reserved verification-tool name during `session_start`.
- **Evidence:** Focused regressions reproduced off-mode persistence after activating an `external_write` tool, missing reserved-name rejection in dormant/off sessions, the implicit-completion activation path, and attempted dynamic replacement of both managed verification tools in every configured mode.
- **Approaches tried:**
  - **Attempt:** Resolve verification policy only during session construction.
    - **Outcome:** Did not work
    - **Why:** The construction-time effect inventory becomes stale after `setActiveToolsByName` changes the active surface.
  - **Attempt:** Install one controller for the configured session mode and gate its hooks and managed tools with a reconciled runtime policy.
    - **Outcome:** Worked
    - **Why:** Runtime activation can safely switch the controller surface without attempting to uninstall subscribed hooks, while controller mutation state remains available to prevent post-effect bypass.
- **Root cause:** Verification activation was derived once from the initial tool inventory instead of being a lifecycle invariant tied to the current effect inventory plus pending recorded effects.
- **Resolution:** Reconcile verification whenever active tools change, keep verification sticky while the controller has a nonzero mutation revision, hide dormant managed tools, validate registered extension names before every registry merge, reserve managed names in every mode, and require `explicit_finish` for every configured evidence/audit session even when initially dormant.
- **Verification:** `task-verification-custom-tool-effects.test.ts` covers dynamic activation, pre-effect deactivation, post-effect stickiness, successful-finish reset, reserved-name collisions, and dormant implicit-completion rejection. `task-verification-dynamic-extension-reservation.test.ts` proves `session_start` registration cannot replace either managed tool in off, evidence, or audit mode.
- **Prevention/follow-up:** Treat active tool changes as policy transitions. Any future dynamic tool API must invoke the same reconciliation path and must not derive mutation semantics from tool names.
- **Reusable learning:** Safety policy based on tool effects must be recomputed when the active tool surface changes, but already-recorded effects must keep completion gates active until a verified reset.
- **References:** `packages/coding-agent/src/core/task-verification-session-runtime.ts`, `packages/coding-agent/test/task-verification-custom-tool-effects.test.ts`
