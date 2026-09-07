# 2026-09-05 — Test snapshots must prune generated output

- **Status:** Resolved
- **Task/context:** Auditing task-verification snapshot overhead and false completion debt in the coding agent.
- **Unexpected observation or failure:** The Git-backed test snapshot enumerated ignored dependency and build-output tests even though the fallback walker and source snapshot exclude those directories.
- **Evidence:** In the release worktree, 332 of 353 captured test paths were under skipped directories: 324 under `node_modules` and 8 under `dist`. A fixture with 2,001 ignored dependency tests made the snapshot return `undefined`, losing a real ignored project test and forcing later pathless mutations into fail-closed test-path overflow.
- **Approaches tried:**
  - **Attempt:** Keep the unbounded ignored-file query and filter only with the test filename pattern in JavaScript.
    - **Outcome:** Did not work
    - **Why:** Dependency test files still consumed the 2,000-path bound and required unnecessary filesystem metadata reads.
  - **Attempt:** Apply the canonical workspace-effect skipped segments as negative Git pathspecs before test-pattern filtering.
    - **Outcome:** Worked
    - **Why:** Generated and dependency trees no longer enter the bounded snapshot, while ignored project tests outside those trees remain observable.
- **Root cause:** The Git path used only `TEST_PATH_PATTERN`; it did not share the canonical skipped-directory contract already used by fallback and source snapshots.
- **Resolution:** Reuse `WORKSPACE_EFFECT_SKIPPED_SEGMENTS` for the fallback walker and for negative pathspecs in the ignored-file Git query.
- **Verification:** The regression creates more than 2,000 ignored dependency tests plus ignored `dist` output and proves that the snapshot remains defined, contains only the ignored project test, and detects its subsequent rewrite.
- **Prevention/follow-up:** Keep Git-backed and filesystem-walk snapshot scopes aligned through one canonical skipped-segment list; exercise the bounded overflow case whenever scope changes.
- **Reusable learning:** Apply scope exclusions before bounded collection, not after enumeration, or irrelevant generated data can consume safety limits and turn conservative guards into false blockers.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/test-workspace-snapshot.ts`, `packages/coding-agent/test/task-verification-test-workspace-snapshot.test.ts`
