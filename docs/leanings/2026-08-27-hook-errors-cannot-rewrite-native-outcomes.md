# 2026-08-27 — Hook errors cannot rewrite native outcomes

- **Status:** Resolved
- **Task/context:** Follow-up review of the native tool-result trust boundary introduced for task-verification proof evidence.
- **Unexpected observation or failure:** A result hook returning `isError: false` could turn a native failing command into passing evidence. In the opposite direction, a hook returning `isError: true` could prevent a successful direct mutation from advancing the verification mutation revision.
- **Evidence:** Two real hook-chain regressions failed before the fix: native failing Bash evidence returned `isError: false`, and a native successful direct write with a hook-promoted presentation error left `mutationRevision` at zero. Additional guards proved hook-promoted evidence failure remains supported and native failure stays monotonic on non-evidence paths.
- **Approaches tried:**
  - **Attempt:** Use `previousResult.isError` as a replacement for the native error state and reuse that value for mutation detection.
    - **Outcome:** Did not work
    - **Why:** Presentation hooks then controlled both evidence truth and whether the controller observed the executed mutation.
  - **Attempt:** Compute evidence error monotonically from native failure or hook promotion, while settling mutations only from the native execution outcome.
    - **Outcome:** Worked
    - **Why:** Hooks can conservatively reject evidence without rewriting what the tool actually executed.
- **Root cause:** One `effectiveIsError` value conflated two distinct domains: native execution/mutation truth and post-hook evidence presentation.
- **Resolution:** Native failure is never demoted, hook promotion remains a valid evidence failure, all controller return paths expose the monotonic error, and mutation detection receives only the native error state.
- **Verification:** `task-verification-hook-error-monotonicity.test.ts` covers native-failure demotion, hook-promoted evidence failure, successful mutation tracking under promotion, and native failure on a non-evidence path. The proof-ingestion suites remain green.
- **Prevention/follow-up:** Keep native execution outcome separate from conservative presentation or evidence overrides in every future result-hook integration.
- **Reusable learning:** Result hooks may add failure but must never erase native failure or change whether a successful native mutation occurred.
- **References:** `docs/leanings/2026-08-27-proof-witness-ingestion-must-use-native-results.md`, `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/mutation-tracking.ts`, `packages/coding-agent/test/task-verification-hook-error-monotonicity.test.ts`
