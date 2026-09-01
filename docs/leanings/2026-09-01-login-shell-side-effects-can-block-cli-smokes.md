# 2026-09-01 — Login-shell side effects can block CLI smokes

- **Status:** Resolved
- **Task/context:** A live AI-unit launched `p` inside a detached tmux session with an isolated configuration directory.
- **Unexpected observation or failure:** The pane displayed an SSH private-key passphrase prompt before the CLI started, making the provider run appear blocked.
- **Evidence:** Process inspection showed the tmux command entered the user's login-shell startup path, which invoked `ssh-add`; no provider request or `p` interaction had started.
- **Approaches tried:**
  - **Attempt:** Add the identity non-interactively from the existing shell.
    - **Outcome:** Did not work
    - **Why:** The identity still required interactive authorization and was unrelated to the smoke target.
  - **Attempt:** Start tmux with `/bin/bash --noprofile --norc` and explicit task configuration.
    - **Outcome:** Worked
    - **Why:** It removed unrelated profile side effects while preserving the controlled pseudo-terminal required by the interactive CLI.
- **Root cause:** The smoke harness inherited interactive login-shell initialization, so unrelated credential setup ran before the command under test.
- **Resolution:** Launch interactive CLI smokes in a pseudo-terminal through a non-login shell with profile loading disabled, then pass only the explicit environment needed by the test.
- **Verification:** The replacement session reached the intended `p` indexing prompt and subsequently executed the AI-unit; no SSH credential prompt appeared and no secret was entered.
- **Prevention/follow-up:** Bind smoke processes to their exact executable, cwd, environment, and shell mode. Diagnose pre-start prompts through process ancestry before attributing them to the application or provider.
- **Reusable learning:** A pseudo-terminal is necessary for interactive smokes, but user login profiles are not; disable unrelated startup hooks to keep the test causally scoped.
- **References:** `AGENTS.md` interactive TUI smoke guidance
