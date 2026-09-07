# 2026-08-27 — Thrown result hooks must fail evidence

- **Status:** Resolved
- **Task/context:** Adversarial combined review of the native task-verification result-hook trust boundary.
- **Unexpected observation or failure:** When an earlier `afterToolCall` hook threw after a native successful evidence command, the controller still recorded passing evidence and could auto-finalize it before the original hook error reached the agent.
- **Evidence:** A focused regression observed `nativeIsError: false` and `isError: false` on evidence even though the hook threw and the agent-facing tool result became an error. The same boundary also had to preserve mutation settlement for a native successful write.
- **Approaches tried:**
  - **Attempt:** Run the controller with no prior result after catching the earlier hook exception, then rethrow the exception.
    - **Outcome:** Did not work
    - **Why:** The controller interpreted the absent override as native success and accepted the evidence before the exception was restored.
  - **Attempt:** Supply a synthetic presentation-only `isError: true` override to the controller while retaining the snapshotted native outcome for mutation settlement.
    - **Outcome:** Worked
    - **Why:** Evidence fails conservatively, the original hook exception remains agent-visible, and a native successful mutation still advances the mutation revision.
- **Root cause:** The wrapper preserved a returned hook failure but did not represent a thrown hook failure in the controller's evidence error domain.
- **Resolution:** A caught earlier hook exception now promotes controller-visible evidence to failed before the original exception is rethrown; native mutation tracking remains bound to the native error state.
- **Verification:** `task-verification-hook-error-monotonicity.test.ts` establishes an exact failing baseline, mutates, and replays the baseline through a throwing hook to verify failed current-revision evidence, no auto-finalization, original error identity, and successful native mutation settlement.
- **Prevention/follow-up:** Test returned and thrown hook failures separately at every evidence boundary; exceptions are conservative presentation failures, not missing overrides.
- **Reusable learning:** A thrown post-result hook is at least as strong as an explicit failure override for evidence, but it must not rewrite the native execution outcome.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/tool-integration.ts`, `packages/coding-agent/test/task-verification-hook-error-monotonicity.test.ts`
