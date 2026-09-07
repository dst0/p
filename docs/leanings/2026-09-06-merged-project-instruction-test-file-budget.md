# 2026-09-06 — Verify file budgets on the PR merge result

- **Status:** Resolved
- **Task/context:** Publish the release-candidate PR after local non-e2e tests, source checks, reinstall, SDK smoke, and historical release audit passed.
- **Unexpected observation or failure:** PR #115 passed dependency installation and build but failed the source-file structure check. The merged `project-instructions-processor.test.ts` contained 328 physical lines, exceeding the 300-line limit, although the feature checkout had passed its local check.
- **Evidence:** GitHub Actions run `34000013510`, job `101397067289`, failed at `Check`. A local non-committing merge of main `431054fe2def2b76d8c02e6e5fbda71ffe2b28cf` reproduced the same 328-line failure with `node scripts/check-file-structure.js`.
- **Approaches tried:**
  - **Attempt:** Rely on the already-green feature checkout and a conflict-free merge-tree calculation.
    - **Outcome:** Did not establish merge-result policy compliance.
    - **Why:** A conflict-free textual merge can combine independently valid additions into an oversized file.
  - **Attempt:** Integrate current main without rewriting published history, then move one coherent test responsibility into its own descriptively named suite.
    - **Outcome:** Worked; both responsibility-scoped test files contain 185 physical lines.
    - **Why:** This preserves all regression behavior while satisfying the existing limit rather than weakening the baseline.
- **Root cause:** Main advanced during verification and added logical-link validation cases to the same test file; Git merged them successfully, but their combined physical size violated a repository-wide constraint.
- **Resolution:** Move the five cache/materialization lifecycle cases into `project-instructions-cache-materialization.test.ts`, retaining the processor/discovery cases in the original file. Preserve all nine test blocks and 44 assertions verbatim, with independent temporary-directory cleanup. Add the merge-result validation reminder to `AGENTS.md`.
- **Verification:** The 328-line failure was reproduced before the split. The original focused suite passed 16/16; after the split, processor passed 11/11 and cache materialization passed 5/5. The structure checker passed for 2,431 source files, Biome passed for both files, and `git diff --check` passed. Another 43 focused tests cover the integrated main changes. Full integrated coverage and remote CI remain separate delivery gates.
- **Prevention/follow-up:** When main advances, validate the actual integrated source tree, including structural limits, before relying on branch-only results. Keep head, base, and merge-result evidence distinct.
- **Reusable learning:** Independent green branches can violate additive global constraints after a conflict-free merge.
- **References:** https://github.com/dst0/p/pull/115, https://github.com/dst0/p/actions/runs/34000013510, `scripts/check-file-structure.js`
