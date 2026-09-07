# 2026-08-30 — Shell search patterns must be literal

- **Status:** Resolved
- **Task/context:** Search tests for semicolon-bearing backticked literals while auditing prompt and validator consistency.
- **Unexpected observation or failure:** A search pattern containing backticks was placed inside a double-quoted shell command, so the shell attempted command substitution before `rg` ran.
- **Evidence:** The command emitted a shell `command not found` diagnostic for text that should have remained part of the search pattern; no repository files were changed.
- **Approaches tried:**
  - **Attempt:** Embed the regular expression directly in a double-quoted shell command.
    - **Outcome:** Did not work
    - **Why:** Backticks retain command-substitution semantics inside double quotes.
  - **Attempt:** Use literal single-quoted arguments or a file-backed command when search text contains shell metacharacters.
    - **Outcome:** Worked
    - **Why:** The shell receives the pattern as data instead of executable syntax.
- **Root cause:** The command composition boundary did not distinguish a regular-expression metacharacter from a shell metacharacter.
- **Resolution:** Subsequent searches use literal quoting and avoid interpolating backticks or command substitutions into shell command strings.
- **Verification:** The failed command made no filesystem changes, and later file inspection used safe literal commands.
- **Prevention/follow-up:** Prefer single-quoted fixed patterns; for complex or generated patterns, put the command in a reviewed temporary script rather than nesting shell syntax.
- **Reusable learning:** Search patterns are untrusted shell input until quoted literally; backticks and `$()` must never cross the command boundary unescaped.
- **References:** `AGENTS.md` command escaping guidance
