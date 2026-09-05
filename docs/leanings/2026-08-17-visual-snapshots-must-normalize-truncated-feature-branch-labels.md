# 2026-08-17 — Visual snapshots must normalize truncated feature-branch labels

- **Status:** Resolved
- **Task/context:** Running the full unit suite from an isolated feature-branch worktree.
- **Unexpected observation or failure:** Four interactive UI snapshots expected `(main)` but rendered a long feature branch truncated before its closing parenthesis.
- **Evidence:** The coding-agent suite passed 2,196 tests and failed four snapshots only on `~/dev/p/packages/coding-agent (codex/requirement-audit-cert...`; the existing sanitizer normalized complete parenthesized branch labels but not the unterminated viewport form.
- **Approaches tried:**
  - **Attempt:** Update the snapshots with the current feature-branch label.
    - **Outcome:** Did not work
    - **Why:** That would make deterministic fixtures depend on one temporary branch and simply move the failure to other branches.
  - **Attempt:** Normalize the targeted coding-agent status line when terminal truncation ends it with an ellipsis.
    - **Outcome:** Worked
    - **Why:** It removes only volatile branch text while retaining the stable path and canonical `(main)` fixture representation.
- **Root cause:** The sanitizer required a closing `)` before recognizing branch text, while the 80-column viewport truncates long branch labels before that character.
- **Resolution:** Normalize truncated branch suffixes on the coding-agent path before applying the existing complete-parenthesis normalization.
- **Verification:** Both positive and negative regressions failed before their respective sanitizer changes and then passed together with all four interactive UI snapshot tests: two files and six tests total.
- **Prevention/follow-up:** Snapshot sanitizers should cover both complete and viewport-truncated forms of every volatile status field.
- **Reusable learning:** Normalize volatile terminal fields after accounting for width truncation; delimiters visible in the source string may be absent from the captured viewport.
- **References:** `packages/coding-agent/test/ui-visual-snapshot-sanitization.test.ts`, `packages/coding-agent/test/helpers/ui-visual-snapshot-harness.ts`, `packages/coding-agent/test/interactive-ui-regression.test.ts`
