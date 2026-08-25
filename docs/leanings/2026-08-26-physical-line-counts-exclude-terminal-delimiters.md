# 2026-08-26 — Physical line counts exclude terminal delimiters

- **Status:** Resolved
- **Task/context:** Add immediate source-size feedback without changing the repository's existing 250-line completion boundary.
- **Unexpected observation or failure:** The existing counter used `content.split("\n").length`, so a newline-terminated file containing exactly 250 physical lines was reported as 251 and rejected.
- **Evidence:** The failing-first boundary test wrote 250 newline-terminated source lines and received a `251 lines` warning.
- **Approaches tried:**
  - **Attempt:** Preserve the split-array count and adjust the new test expectation.
    - **Outcome:** Rejected
    - **Why:** It would encode an off-by-one error and make the documented 250-line limit stricter for conventionally terminated text files.
  - **Attempt:** Subtract the trailing empty split element when the content ends in a newline.
    - **Outcome:** Worked
    - **Why:** It counts physical content lines while retaining correct counts for unterminated files and zero for an empty file.
- **Root cause:** A terminal newline is a delimiter after the final line, not an additional physical source line.
- **Resolution:** Source-size checks share a canonical `physicalLineCount` helper that excludes the terminal empty segment.
- **Verification:** `task-verification-workspace.test.ts` proves exactly 250 newline-terminated lines are allowed, 251 are warned, and shrinking back to 250 clears the warning.
- **Prevention/follow-up:** Keep line-boundary tests paired at `limit` and `limit + 1` whenever structural limits change.
- **Reusable learning:** Count newline-terminated physical lines as delimiters plus content, not as `split` array length.
- **References:** `packages/coding-agent/src/core/task-verification/source-file-classification.ts`, `packages/coding-agent/test/task-verification-workspace.test.ts`
