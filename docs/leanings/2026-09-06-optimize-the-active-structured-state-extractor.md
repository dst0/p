# 2026-09-06 — Optimize the active structured-state extractor

- **Status:** Resolved
- **Task/context:** Review PR #114, which replaced an array pipeline in `getMessageTextForState` with a loop for structured-state message text extraction.
- **Unexpected observation or failure:** The changed function had no runtime references. The active structured-state path called `getAgentMessageText`, which still used `.filter().map().join()`.
- **Evidence:** LSP references for `getAgentMessageText` included its definition and `collectOriginalUserRequests`; source inspection showed the active function retained the old chain. The PR's own tests exercised only `getMessageTextForState`.
- **Approaches tried:**
  - **Attempt:** Keep the optimization only in `getMessageTextForState`.
    - **Outcome:** Did not work.
    - **Why:** It left the active extraction path unchanged.
  - **Attempt:** Move the one-pass block extractor into `state-extraction.ts` and reuse it from both public functions.
    - **Outcome:** Worked.
    - **Why:** The active and directly tested paths now share one implementation without a circular dependency.
- **Root cause:** Two duplicate message-text extraction functions had drifted apart, and the PR updated only the unused one.
- **Resolution:** Exported the one-pass block extractor from `state-extraction.ts`; both `getAgentMessageText` and `getMessageTextForState` now use it. The shared extractor intentionally skips non-string text blocks, matching the defensive contract already covered by the direct state-analysis tests. Removed the duplicate `.jules` learning and added canonical release evidence.
- **Verification:** `message-analysis.test.ts` passes 14/14 tests, `structured-state.test.ts` passes 24/24 tests, and `npm run check` passes with Biome, file-structure, dependency, import, shrinkwrap, TypeScript, and browser-smoke checks.
- **Prevention/follow-up:** When optimizing a helper, verify LSP references and test the active caller, not only a similarly named exported function.
- **Reusable learning:** Performance changes are incomplete until the optimized implementation is on the runtime call path and a regression protects that path.
- **References:** `packages/coding-agent/src/core/compaction/structured-state/state-extraction.ts`, `packages/coding-agent/test/message-analysis.test.ts`, PR #114.
