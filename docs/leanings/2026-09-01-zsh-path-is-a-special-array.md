# 2026-09-01 — zsh path is a special array

- **Status:** Resolved
- **Task/context:** Run a read-only final diff inspection over several changed files from a zsh shell.
- **Unexpected observation or failure:** The first loop iteration printed its file, then later `sed` and `wc` invocations in the same shell failed with `command not found`.
- **Evidence:** The loop variable was named `path`; zsh maps its special lowercase `$path` array to `$PATH`, so assigning the filename replaced command lookup directories for the remainder of that shell.
- **Approaches tried:**
  - **Attempt:** Re-run the inspection in a fresh shell with the task-specific variable name `file_path`.
    - **Outcome:** Worked
    - **Why:** The new name did not mutate zsh command lookup state, and every requested file and line count was read successfully.
- **Root cause:** A generic script variable collided with zsh's special tied `path` array.
- **Resolution:** Use task-specific variable names such as `file_path` in zsh loops and avoid assigning to `path`.
- **Verification:** The replacement inspection completed with exit status zero and resolved `sed` plus `wc` normally.
- **Prevention/follow-up:** Treat `path` like other shell-owned option variables; use descriptive task-scoped names in ad-hoc commands.
- **Reusable learning:** In zsh, never use lowercase `path` as a scratch variable because it rewrites command lookup state.
- **References:** `AGENTS.md`
