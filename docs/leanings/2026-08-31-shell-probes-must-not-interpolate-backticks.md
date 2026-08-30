# 2026-08-31 — Shell probes must not interpolate backticks

- **Status:** Resolved
- **Task/context:** Adversarially probe requirement-risk classification with Markdown inline-code examples containing backticks.
- **Unexpected observation or failure:** A diagnostic command embedded the example in double-quoted shell input, so the shell interpreted the backticks as command substitution before the intended probe ran.
- **Evidence:** The unintended command reached only a failing local npm script lookup and produced a normal npm error log. Repository status showed no mutation, and the same classification probe was reproduced with literal-safe quoting.
- **Approaches tried:**
  - **Attempt:** Pass a backtick-containing probe through double-quoted inline shell code.
    - **Outcome:** Did not work
    - **Why:** Shell command substitution occurs before the target interpreter receives the string.
  - **Attempt:** Pass the probe through literal single-quoted shell input.
    - **Outcome:** Worked
    - **Why:** The Markdown backticks reached the classifier as data instead of executable syntax.
- **Root cause:** The diagnostic transport did not preserve the literal boundary between shell syntax and the test string.
- **Resolution:** Use literal-safe single-quoted input for short probes and a temporary file for complex or multiline diagnostic code.
- **Verification:** The literal-safe rerun reproduced the intended classifier result, and no repository files were changed by the accidental lookup.
- **Prevention/follow-up:** Treat backticks and command substitutions as hostile shell syntax in every diagnostic string; prefer file-backed probes when quoting becomes ambiguous.
- **Reusable learning:** Never place untrusted or Markdown-rich text inside a double-quoted shell command; preserve it as literal data or move the probe into a temporary file.
- **References:** `packages/coding-agent/test/task-requirement-procedural-risk-classification.test.ts`
