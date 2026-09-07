# 2026-09-02 — Tmux smokes must bypass interactive shell initialization

- **Status:** Resolved
- **Task/context:** Start a TTY-backed non-interactive `p` canary from tmux while preserving the repository rule against background invocations without a terminal.
- **Unexpected observation or failure:** The tmux pane displayed a credential passphrase prompt before `p` started, even though the needed identity was already present in the running SSH agent.
- **Evidence:** The blocked pane's process tree contained an interactive shell and its startup `ssh-add` child; no `p` child existed. Starting tmux with the `p` executable as the session command created the expected `p` child immediately and the canary began normal tool activity.
- **Approaches tried:**
  - **Attempt:** Start a detached tmux session with its default interactive shell, then send the `p` command as keystrokes.
    - **Outcome:** Did not work
    - **Why:** Interactive shell initialization ran first and blocked on an unrelated credential-loading command.
  - **Attempt:** Start tmux with the target working directory and `/usr/bin/env ... p ...` as the session command.
    - **Outcome:** Worked
    - **Why:** Tmux still supplied a pseudo-terminal while no interactive shell startup files ran.
- **Root cause:** TTY allocation and interactive shell initialization were accidentally coupled. The smoke needed the former but not the latter.
- **Resolution:** Launch TTY-backed automation as tmux's direct session command, or use a no-rc shell only when a shell is genuinely required.
- **Verification:** The direct-command session produced a `p` process, created its external session log, read the fixture, and reached implementation without a credential prompt.
- **Prevention/follow-up:** Tmux smoke helpers should bind cwd and environment in `tmux new-session` and execute the target directly. Never infer a credential problem until the pane's process tree confirms the target process actually started.
- **Reusable learning:** A pseudo-terminal does not require an interactive login shell; direct tmux commands avoid unrelated startup side effects while preserving correct TTY behavior.
- **References:** `AGENTS.md` TTY smoke guidance
