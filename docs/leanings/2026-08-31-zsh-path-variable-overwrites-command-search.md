# 2026-08-31 — zsh path variables overwrite command search

- **Status:** Resolved
- **Task/context:** Inspect several project files in a small zsh loop while validating task-verification fixes.
- **Unexpected observation or failure:** The first loop iteration reported `sed: command not found` even though `sed` was available immediately before and after the command.
- **Evidence:** The loop variable was named `path`. In zsh, the special array parameter `path` is tied to the scalar `PATH`; assigning a file name to the loop variable replaced the process command-search path for the loop body.
- **Approaches tried:**
  - **Attempt:** Rerun the loop with the neutral variable name `target_file`.
    - **Outcome:** Worked
    - **Why:** The new name does not alias a zsh special parameter, so the inherited `PATH` remained intact and every file read succeeded.
- **Root cause:** zsh exposes lowercase `path` as a special array representation of `PATH`, unlike an ordinary disposable shell variable.
- **Resolution:** Use task-specific neutral names such as `target_file` or `candidate_path` in zsh loops and scripts; never use lowercase `path` as a local scratch variable.
- **Verification:** The otherwise identical loop completed successfully after renaming only the iterator.
- **Prevention/follow-up:** Keep the repository rule to avoid common system-option variables and include zsh lowercase `path` in that mental denylist.
- **Reusable learning:** In zsh, assigning to `path` mutates `PATH`; use a more specific variable name.
- **References:** `AGENTS.md`, `docs/leanings/README.md`
