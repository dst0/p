# 2026-09-26 — Fresh worktrees need built workspace packages

- **Status:** Resolved
- **Task/context:** Validate the cold project-instruction startup fix in a new isolated p worktree.
- **Unexpected observation or failure:** The first full `./test.sh` run reported dozens of module-resolution failures despite passing focused source tests.
- **Evidence:** The fresh worktree lacked internal package `dist` outputs; after `./reinstall.sh` built and relinked the workspaces, the next full run cleared those module failures. The remaining failure was a separate process-timeout fixture.
- **Approaches tried:**
  - **Attempt:** Run the full suite before building the new worktree.
    - **Outcome:** Did not work
    - **Why:** Internal package imports resolve to compiled workspace output.
  - **Attempt:** Run the repository's `./reinstall.sh`, then repeat the suite.
    - **Outcome:** Worked
    - **Why:** The script built the missing outputs using the supported install path.
- **Root cause:** A new worktree does not inherit ignored build artifacts from another checkout.
- **Resolution:** Build through `./reinstall.sh` before the full suite in a fresh worktree, while coordinating the shared global CLI and indexing daemon.
- **Verification:** The post-build suite cleared all missing-module failures. After correcting a separate fixture timeout, final `./test.sh`, `npm run check`, and `./reinstall.sh` passed.
- **Prevention/follow-up:** Added the ordering rule to `AGENTS.md`; do not interpret missing `dist` as a source regression without checking build state.
- **Reusable learning:** Treat ignored workspace build outputs as worktree-local prerequisites, not shared repository state.
- **References:** `AGENTS.md`, `./reinstall.sh`, `./test.sh`
