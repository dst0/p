# 2026-08-20 — Ignored archives can mask incomplete benchmark publication

- **Status:** Resolved
- **Task/context:** Publish restored and newly generated benchmark evidence after
  the local archive-integrity gate passed.
- **Unexpected observation or failure:** CI reported thirteen broken Brotli
  references although the same test was green in the development worktree.
- **Evidence:** Eleven referenced archives existed locally under ignored
  recording paths but were absent from `git ls-files`: two replacements for
  deleted gzip diagnostics and nine recordings for newly added result files.
- **Approaches tried:**
  - **Attempt:** Narrow the test because older benchmark evidence appeared to
    be outside the migration scope.
    - **Outcome:** Rejected after inspecting the exact targets.
    - **Why:** Every reported target was task-owned and required by a changed or
      newly added evidence document.
  - **Attempt:** Require both filesystem existence and Git tracking for every
    Brotli reference, then force-stage only the missing archives.
    - **Outcome:** Worked.
    - **Why:** The local gate now models the clean CI checkout while preserving
      the repository's intentional broad ignore rule.
- **Root cause:** `existsSync` treated ignored local archives as publishable
  evidence, so the pre-commit test could not detect files omitted from the
  index.
- **Resolution:** Archive integrity now derives its target inventory from
  `git ls-files`, rejects empty intent-to-add entries, and fully decodes the
  staged Git blob; all eleven omitted archives were validated and explicitly
  force-staged without broadening the ignore policy.
- **Verification:** The strengthened test failed locally with the same thirteen
  references as CI before staging and passed after all eleven unique targets
  became tracked. The two converted diagnostics decode byte-for-byte to their
  deleted gzip sources, and all eleven Brotli streams pass integrity checks.
- **Prevention/follow-up:** Evidence-reference tests must assert publication
  state, not only worktree state, whenever archive paths are intentionally
  ignored.
- **Reusable learning:** A clean local filesystem is not proof of a complete
  commit; ignored dependencies require index-aware referential-integrity tests.
- **References:** `scripts/benchmark-archive-references.test.js`, GitHub Actions
  run `32297286225`.
