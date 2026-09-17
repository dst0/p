# 2026-09-08 — Process discovery must not print unrelated command lines

- **Status:** Resolved
- **Task/context:** Monitoring one delegated CLI process while several repository tasks were running on the same host.
- **Unexpected observation or failure:** A broad process-name query printed the full command line of an unrelated repository task into the current task output.
- **Evidence:** The delegated process was already bound to a tracked execution-session handle, but a later process-name search returned more than that session and included another task's prompt arguments.
- **Approaches tried:**
  - **Attempt:** Search the global process table by a shared executable name.
    - **Outcome:** Did not work
    - **Why:** The executable name was shared across independent tasks, and full command-line output crossed the repository context boundary.
  - **Attempt:** Poll only the execution-session handle and inspect scoped Git status or the task-specific log.
    - **Outcome:** Worked
    - **Why:** Those identifiers and files were created by the current task and reveal no unrelated process arguments.
- **Root cause:** Process-name matching is not a repository or task identity boundary, and full process arguments can contain prompts, paths, or other sensitive context.
- **Resolution:** Monitor delegated commands through their captured execution-session handle and task-specific log. Use an exact pre-recorded PID only when the session API is unavailable, and never print global matching command lines.
- **Verification:** Subsequent progress checks used only the current execution-session handle, the current task's log, and its exact worktree status.
- **Prevention/follow-up:** Keep process discovery scoped to identifiers captured when the current task launched the process; treat broad `ps` or `pgrep` command-line output as sensitive cross-task data.
- **Reusable learning:** A shared executable name is not an isolation key; never use broad process-command output to monitor a repository-bound subtask.
- **References:** `AGENTS.md`
