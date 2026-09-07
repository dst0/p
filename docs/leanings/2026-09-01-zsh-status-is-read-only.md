# 2026-09-01 — zsh status is read-only

- **Status:** Resolved
- **Task/context:** A focused Vitest command was wrapped to capture its output and propagate the exact process exit code.
- **Unexpected observation or failure:** The wrapper stopped before reporting the test result with `read-only variable: status`.
- **Evidence:** zsh rejected the assignment immediately; the same command completed successfully after the result variable was renamed.
- **Approaches tried:**
  - **Attempt:** Store the child exit code in `status`.
    - **Outcome:** Did not work
    - **Why:** `status` is a special read-only zsh parameter.
  - **Attempt:** Store the child exit code in the task-specific variable `result_code`.
    - **Outcome:** Worked
    - **Why:** The name does not collide with a shell-owned parameter, so the wrapper preserved and returned the test exit code.
- **Root cause:** The wrapper reused a zsh special parameter name instead of a task-specific variable.
- **Resolution:** Use a task-specific exit-code variable such as `result_code` in zsh wrappers.
- **Verification:** The corrected wrapper ran all nine targeted test files, reported 41 of 41 tests passing, and exited zero.
- **Prevention/follow-up:** Keep shell wrapper variables descriptive and avoid common shell option or special-parameter names.
- **Reusable learning:** In zsh, never assign to `status`; use a task-specific result variable and propagate it explicitly.
- **References:** `docs/leanings/README.md`
