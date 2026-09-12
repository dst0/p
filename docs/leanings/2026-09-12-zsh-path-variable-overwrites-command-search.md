# 2026-09-12 — Zsh path variables can overwrite command search

- **Status:** Resolved
- **Task/context:** Staging an explicit NUL-delimited list of changed paths in a large worktree.
- **Unexpected observation or failure:** Assigning each pathname to the shell variable `path` made every later `git` and `tail` invocation fail with `command not found`.
- **Evidence:** The first file staged successfully, then the same loop emitted one command lookup failure per remaining entry; a fresh shell retained the normal environment.
- **Approaches tried:**
  - **Attempt:** Use `path` as a generic loop variable in zsh.
    - **Outcome:** Did not work
    - **Why:** Zsh exposes `path` as a special array tied to the scalar `PATH`, so assignment rewrites command search for that shell.
  - **Attempt:** Use a task-specific variable name and rerun the explicit-path loop in a fresh shell.
    - **Outcome:** Worked
    - **Why:** The repository paths were unchanged and each `git add -- <path>` retained normal command lookup.
- **Root cause:** A zsh special parameter was mistaken for an ordinary local variable.
- **Resolution:** Use task-specific names such as `staged_path`; never assign to `path`, `PATH`, `home`, `HOME`, or other environment and shell-control parameters.
- **Verification:** The corrected loop stages every intended path, and cached/unstaged status is inspected afterward.
- **Prevention/follow-up:** Prefer descriptive task-scoped shell variables and verify command availability after any loop that orchestrates repository mutations.
- **Reusable learning:** In zsh, lowercase `path` is not a harmless pathname variable; assigning it mutates `PATH`.
- **References:** `AGENTS.md` command-variable guidance.
