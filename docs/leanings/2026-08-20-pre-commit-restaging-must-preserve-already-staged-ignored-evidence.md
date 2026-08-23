# 2026-08-20 — Pre-commit restaging must preserve already staged ignored evidence

- **Status:** Resolved
- **Task/context:** Commit independently restored benchmark recordings that are
  intentionally ignored by the repository's general evidence rule.
- **Unexpected observation or failure:** The pre-commit hook passed every
  validation command, then rejected the commit while restaging a recording that
  was already force-added to the index.
- **Evidence:** Git reported that the recording directory was ignored at the
  hook's plain `git add "$file"` step; the index already contained exactly 18
  intentional `.jsonl.br` replacements.
- **Approaches tried:**
  - **Attempt:** Bypass the hook or temporarily change the ignore policy.
    - **Outcome:** Rejected.
    - **Why:** That would remove validation or broaden the permanent evidence
      policy just to publish a reviewed exception.
  - **Attempt:** Restage only current index members with NUL-delimited paths and
    `git add -f --` after formatting.
    - **Outcome:** Worked.
    - **Why:** Force applies only to files already selected in the index, while
      NUL delimiting also preserves filenames containing spaces.
- **Root cause:** The hook forgot that an intentionally force-staged ignored
  file remains ignored when the formatter restaging loop later calls plain
  `git add`.
- **Resolution:** Moved formatter restaging into a focused helper that reads the
  current index safely, rejects partially staged paths before formatting, and
  force-restages additions, modifications, and deletions only for those indexed
  paths using literal Git pathspecs. The hook now also propagates helper
  failures.
- **Verification:** A temporary-repository regression force-stages an ignored
  archive with special characters in its name, modifies it, and proves the
  helper updates its index content without staging unrelated work. Additional
  cases cover pre-staged deletion, deletion during formatting, partial staging,
  colon-prefixed pathspec magic, and hook-level restaging failure.
- **Prevention/follow-up:** Keep ignore exceptions explicit at initial staging;
  post-validation restaging must operate only on paths already present in the
  index.
- **Reusable learning:** `git add -f` is safe for formatter restaging only when
  its input is derived from the existing index rather than the working tree.
- **References:** `.husky/pre-commit`, `scripts/restage-precommit-files.js`,
  `scripts/pre-commit-restage.test.js`
