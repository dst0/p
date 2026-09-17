# 2026-09-09 — Zsh path loop variables overwrite command search

- **Status:** Resolved
- **Task/context:** Hash a frozen set of changed files before assigning an independent review on macOS zsh.
- **Unexpected observation or failure:** After the first loop iteration, ordinary commands such as `git` and `ls` became unavailable in the same shell invocation.
- **Evidence:** The loop used `for path in ...`; zsh exposes `path` as a tied array for `PATH`, so assigning the filename replaced the command-search path. Re-running with a task-specific variable and absolute `/usr/bin/shasum` completed successfully.
- **Approaches tried:**
  - **Attempt:** Use the generic loop variable `path` in a multi-command zsh invocation.
    - **Outcome:** Did not work
    - **Why:** In zsh, lowercase `path` is a special parameter tied to `PATH`.
  - **Attempt:** Rename the loop variable to `task_file` and avoid relying on command lookup for the hash utility.
    - **Outcome:** Worked
    - **Why:** The shell's command-search state remained unchanged.
- **Root cause:** A common-looking variable name collided with a zsh special parameter.
- **Resolution:** Re-ran the read-only snapshot calculation with a task-specific variable name and verified all hashes and `git diff --check`.
- **Verification:** The corrected invocation found `git` and `ls`, produced every expected SHA-256, and exited successfully.
- **Prevention/follow-up:** In zsh automation, do not assign `path`; use task-specific names such as `task_file` and keep critical utilities explicit when constructing evidence.
- **Reusable learning:** Shell-local variable names can mutate process behavior; avoid zsh special parameters in orchestration commands.
- **References:** `AGENTS.md`
