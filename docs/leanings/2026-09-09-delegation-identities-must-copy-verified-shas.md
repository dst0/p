# 2026-09-09 — Delegation identities must copy verified SHAs

- **Status:** Resolved
- **Task/context:** Bind parallel AGY and review tasks to exact dirty Git worktrees while several related worktrees were active.
- **Unexpected observation or failure:** A manually transcribed expected HEAD SHA was mistyped in a delegation draft even though the worktree had already been inspected.
- **Evidence:** Comparing the draft against fresh `git rev-parse HEAD` output found the mismatch before the delegated agent began repository work.
- **Approaches tried:**
  - **Attempt:** Re-enter the long identity from visual memory.
    - **Outcome:** Did not work
    - **Why:** Full commit identifiers are not safely reproducible by manual transcription.
  - **Attempt:** Re-read path, repository root, branch, HEAD, status, and diff hashes from the assigned worktree and copy those exact outputs into the prompt.
    - **Outcome:** Worked
    - **Why:** The delegated preflight could compare immutable strings from the same snapshot without inference.
- **Root cause:** The delegation identity was treated as prose instead of machine-derived evidence.
- **Resolution:** Corrected the draft before launch and required every delegated task to stop on any path, branch, HEAD, status, or scoped content-hash mismatch.
- **Verification:** Subsequent reviewers reported the exact assigned path, branch, full HEAD, and frozen diff hashes before accepting findings.
- **Prevention/follow-up:** Generate or copy delegation identities directly from command output; never retype commit SHAs from memory or abbreviate them in executable task bindings.
- **Reusable learning:** A delegated worktree identity is data, not narration: copy verified values verbatim and make mismatch fail closed.
- **References:** `AGENTS.md`
