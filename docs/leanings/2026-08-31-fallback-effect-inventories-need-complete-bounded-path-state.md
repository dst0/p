# 2026-08-31 — Fallback effect inventories need complete bounded path state

- **Status:** Resolved
- **Task/context:** Make evidence-mode workspace-effect verification work outside Git while retaining exact task-owned paths and fail-closed bounds.
- **Unexpected observation or failure:** The fallback inventory accepted ordinary files but skipped symbolic links, while Git parsing silently dropped or rewrote filenames that the completion contract could not represent and the first regression encoded all non-Git work as untrackable.
- **Evidence:** Adversarial review showed that a pathless command could retarget a symlink without adding it to `taskOwnedPaths`; control-character and POSIX backslash filenames could be omitted or mapped to a different path; the fallback walker also needed explicit tests for its snapshot and 128-path ledger boundaries.
- **Approaches tried:**
  - **Attempt:** Reject every non-Git mutation.
    - **Outcome:** Did not work
    - **Why:** It was conservative but made bounded, observable non-Git work permanently unfinishable.
  - **Attempt:** Compare bounded pre/post path-state inventories and retain each path's original baseline.
    - **Outcome:** Worked
    - **Why:** Content, executable-bit, deletion, and symlink-target states can be compared deterministically without claiming pre-existing unchanged paths.
- **Root cause:** Path collection treated regular normalized source files as the complete mutation surface and did not distinguish deliberate internal-path exclusions from filenames that were unsafe to represent.
- **Resolution:** Inventories now include ordinary files and symlinks, exclude internal/dependency paths, retain original per-path baselines, fail closed on unrepresentable names, and report snapshot or ledger overflow rather than claiming complete scope.
- **Verification:** `task-verification-workspace-effect-ledger.test.ts` covers non-Git docs, config, assets, symlink staleness, and exact `files_changed`; `task-verification-non-git-overflow.test.ts` covers snapshot failure, ledger overflow, and restored baselines; `task-verification-unrepresentable-paths.test.ts` covers control and backslash names.
- **Prevention/follow-up:** Keep new path kinds paired across asynchronous capture, stable hashing, exact completion comparison, and explicit overflow regressions.
- **Reusable learning:** A fail-closed effect ledger must inventory every path type its hasher understands, preserve the first observed baseline, and distinguish bounded success from actual tracking failure.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/source-workspace-snapshot.ts`, `packages/coding-agent/test/task-verification-workspace-effect-ledger.test.ts`, `packages/coding-agent/test/task-verification-non-git-overflow.test.ts`, `packages/coding-agent/test/task-verification-unrepresentable-paths.test.ts`
