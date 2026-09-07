# 2026-09-05 — Squash merges do not authorize fragment reuse

- **Status:** Resolved
- **Task/context:** Preparing a long-running feature continuation for squash-only merge and later certified release.
- **Unexpected observation or failure:** A branch changed a release-note fragment that already existed on `origin/main`, which would make a historical fragment ID represent new work in the final squash diff.
- **Evidence:** `.changes/project-instructions-benchmark-evidence.json` exists on `origin/main`. The final worktree restores that file byte-for-byte and records the continuation's additional internal evidence under the new `.changes/project-instructions-release-evidence-provenance.json` ID.
- **Approaches tried:**
  - **Attempt:** Treat rewriting or cleaning the branch's intermediate commit history as necessary for the release audit.
    - **Outcome:** Partial
    - **Why:** It can simplify branch-local history, but squash-only merge collapses those commits and makes the final tree diff against main the relevant change set.
  - **Attempt:** Restore the existing fragment and add one unique reason-form fragment for the new non-user-facing work.
    - **Outcome:** Worked
    - **Why:** The squash leaves the historical fragment's ID and bytes unchanged while adding current evidence under a distinct policy-compliant ID.
- **Root cause:** Branch-local commit history was confused with the post-squash first-parent history, and an unreleased file still present in the tree was incorrectly treated as reusable release-note identity.
- **Resolution:** Preserve every fragment already present on the target base byte-for-byte and use a unique new fragment ID for later work, including `type: "None"` work that requires a concrete `reason`.
- **Verification:** Compared both fragment files with `origin/main` in the rebased worktree and traced the deterministic fragment provenance path in `scripts/release-change-fragments.js`; the legacy path has no diff against `origin/main`, while the new reason-form path is added.
- **Prevention/follow-up:** Before merging a squash PR, compare `.changes` paths with the exact target base. Existing paths must remain byte-identical; simulate or inspect the final squash tree before running release certification.
- **Reusable learning:** Squash collapses branch commits, not the target branch's prior history. Never reuse or modify a fragment ID already introduced on the target base.
- **References:** `scripts/release-change-fragments.js`, `.github/workflows/ci.yml`, `.changes/project-instructions-benchmark-evidence.json`, `.changes/project-instructions-release-evidence-provenance.json`
