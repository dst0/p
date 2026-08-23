# 2026-08-17 — Parallel agents must receive and verify the exact worktree path

- **Status:** Resolved
- **Task/context:** Parallelizing release-workflow hardening across the main checkout and an isolated feature worktree.
- **Unexpected observation or failure:** A replacement subagent reported completing SHA-pinning but wrote its two files into the main checkout instead of the feature worktree that contained the release implementation.
- **Evidence:** `git status` showed the workflow modification and a new workflow test under the main checkout, while byte comparison showed they differed from the stricter files already present in the feature worktree.
- **Approaches tried:**
  - **Attempt:** Rely on inherited conversation context to identify the intended worktree.
    - **Outcome:** Did not work
    - **Why:** The subagent inherited the process working directory even though the task text referred to the feature worktree.
  - **Attempt:** Resolve both absolute paths, remove only the two agent-owned changes from the main checkout, and retain the independently verified feature-worktree implementation.
    - **Outcome:** Worked
    - **Why:** Path-specific status and byte comparisons separated agent-owned edits from unrelated user changes before cleanup.
- **Root cause:** Delegation named the worktree informally but did not require an initial absolute `pwd` and branch assertion before editing.
- **Resolution:** Restore only the agent-owned main-checkout files, preserve every unrelated change, and continue from `/Users/dst/dev/p-requirement-audit`.
- **Verification:** The two affected paths are clean in the main checkout; the target worktree still contains the stricter SHA-pinned workflow and its focused regression.
- **Prevention/follow-up:** Every multi-worktree subtask must include the absolute worktree path and require `pwd` plus `git branch --show-current` verification before any edit. The parent must verify changed paths in both checkouts before accepting the result.
- **Reusable learning:** Shared filesystem access does not imply a shared current directory; pin and verify the absolute worktree at delegation boundaries.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`
