# 2026-09-06 — Recall score coverage must exercise the public wrapper

- **Status:** Resolved
- **Task/context:** PR #101 precomputes normalized query terms before scoring coding-agent recall candidates.
- **Unexpected observation or failure:** The functional recall path covered the optimized scorer, but CI changed-line coverage still failed because the retained `scoreRecallCandidate()` wrapper was never called directly. The failure reported 60% changed-line coverage and uncovered its normalization and delegation lines.
- **Evidence:** The remote build-check-test run completed 59/59 functional tests, then reported `recall-utils.ts` lines 148–151 as uncovered.
- **Approaches tried:**
  - **Attempt:** Rely on existing session-recall integration coverage for the new optimized path and wrapper.
    - **Outcome:** Did not work.
    - **Why:** The production caller invokes the optimized function directly, so the compatibility wrapper remained unreachable in the suite.
  - **Attempt:** Add focused candidate-scoring cases through the public wrapper.
    - **Outcome:** Worked.
    - **Why:** The tests cover blank, exact, partial, multi-term, single-character, and no-match queries while exercising the wrapper's normalization and delegation.
- **Root cause:** Changed-line coverage measures the retained public wrapper independently from its optimized implementation.
- **Resolution:** Add direct, behavior-focused tests for `scoreRecallCandidate()` and retain the optimized caller path unchanged.
- **Verification:** `test/recall-utils.test.ts` passes 7/7, including mixed long and one-character terms, and `npm run check` passes. The remote CI rerun must still confirm the changed-line coverage gate.
- **Prevention/follow-up:** When splitting a scorer into a precomputed implementation and a compatibility wrapper, test both entry points and each meaningful scoring branch.
- **Reusable learning:** Integration coverage of a replacement implementation does not cover a retained wrapper when production callers bypass that wrapper.
- **References:** PR [#101](https://github.com/dst0/p/pull/101); `packages/coding-agent/src/core/agent-session/recall-utils.ts`; `packages/coding-agent/test/recall-utils.test.ts`.
