# 2026-09-01 — Temporary worktrees can lose active diffs

- **Status:** Partial
- **Task/context:** A long-running release-candidate repair was being developed in an isolated Git worktree created under the operating-system temporary directory.
- **Unexpected observation or failure:** The worktree directory disappeared while a repository check was active, removing the uncommitted diff even though the branch and committed base remained intact.
- **Evidence:** Git reported the worktree registration as prunable because its directory no longer existed. The branch still resolved to its committed base. The active Codex session log retained every successful `apply_patch` input and result, allowing the diff to be reconstructed chronologically in a new permanent worktree.
- **Approaches tried:**
  - **Attempt:** Reopen the original temporary worktree.
    - **Outcome:** Did not work
    - **Why:** The filesystem directory had already been removed; only stale Git metadata remained.
  - **Attempt:** Recreate the branch in a permanent worktree and replay timestamped successful patches from the session record.
    - **Outcome:** Worked
    - **Why:** The committed base was intact and patch calls provided a deterministic edit ledger, including original success or failure status.
- **Root cause:** The exact process that removed the temporary directory was not identified. Locating an active long-running worktree under an OS-managed temporary root made uncommitted state vulnerable to lifecycle cleanup.
- **Resolution:** Prune only the missing worktree registration, recreate the same branch in a stable development path, replay only originally successful repository patches in timestamp order, and re-run focused tests plus the full repository check.
- **Verification:** The reconstructed worktree restored the expected changed-file inventory; 76 focused tests and the full `npm run check` passed after dependencies and workspace build artifacts were hydrated.
- **Prevention/follow-up:** Use permanent development paths for long-running worktrees. Commit coherent checkpoints earlier. When recovery is necessary, correlate patch calls with their result status instead of replaying every attempted patch blindly.
- **Reusable learning:** A branch protects committed history, not an uncommitted temporary worktree; durable work needs a stable path and checkpoint commits, while structured tool logs can serve as a last-resort edit ledger.
- **References:** `docs/leanings/README.md`
