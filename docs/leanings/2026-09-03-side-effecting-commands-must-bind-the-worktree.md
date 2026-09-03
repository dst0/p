# 2026-09-03 — Side-effecting commands must bind the worktree

- **Status:** Resolved
- **Task/context:** Reinstalling a project-instruction release candidate while two long-lived P worktrees were active.
- **Unexpected observation or failure:** `./reinstall.sh` ran from the primary checkout instead of the feature worktree, relinked the shared `p` CLI to the wrong branch, and stopped the shared indexing daemon when that checkout selected an incompatible Python.
- **Evidence:** The failed log named build paths under `/Users/dst/dev/p`; the intended branch lived under `/Users/dst/dev/p-project-instructions-terminal-handshake`. Their HEADs and Python discovery implementations differed.
- **Approaches tried:**
  - **Attempt:** Trust the inherited command cwd after conversation compaction.
    - **Outcome:** Did not work
    - **Why:** The environment cwd identified the primary checkout while the active implementation state was in a different permanent worktree.
  - **Attempt:** Print the absolute cwd and branch in the same command immediately before rerunning reinstall.
    - **Outcome:** Worked
    - **Why:** The observable precondition was bound to the side effect, and the intended checkout selected its existing Python 3.12 compatibility fix.
- **Root cause:** The side-effecting command relied on inherited process context instead of revalidating the explicit worktree recorded in the active task state.
- **Resolution:** Rerun from the exact feature worktree and add an explicit preflight rule for install, relink, daemon, release, and benchmark commands.
- **Verification:** The corrected reinstall printed the expected absolute path and branch before build/relink; its managed venv selected Python 3.12 and installed every pinned dependency successfully.
- **Prevention/follow-up:** Keep absolute worktree and branch verification adjacent to every shared-state command. This strengthens the related long-test and subagent worktree rules rather than relying on conversation memory.
- **Reusable learning:** A correct command in the wrong worktree is an incorrect operation; bind cwd and branch at the side-effect boundary.
- **References:** `docs/leanings/2026-08-24-long-tests-must-verify-runner-cwd-and-lifecycle.md`, `docs/leanings/2026-08-17-parallel-agents-must-receive-and-verify-the-exact-worktree-path.md`
