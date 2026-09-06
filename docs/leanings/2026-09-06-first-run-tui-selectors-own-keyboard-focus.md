# 2026-09-06 — First-run TUI selectors own keyboard focus

- **Status:** Resolved
- **Task/context:** Verify interactive startup and shutdown of fresh Node, Bun-package, and standalone CLI artifacts in controlled terminals.
- **Unexpected observation or failure:** A smoke helper timed out waiting for Ctrl+D to exit even though the CLI had rendered its correct version and credential-free startup guidance.
- **Evidence:** The captured pane showed the first-run Code indexing selector, which explicitly advertises Escape/Ctrl+C to cancel. Ctrl+D was sent before returning focus to the editor. After cancellation and a fresh editor-state check, all three variants exited cleanly with status zero.
- **Approaches tried:**
  - **Attempt:** Send the editor's exit shortcut immediately after observing the startup header.
    - **Outcome:** Did not work
    - **Why:** The active selector, not the editor, owned keyboard input.
  - **Attempt:** Inspect the pane, cancel an optional selector, confirm editor readiness, then send the exit shortcut.
    - **Outcome:** Worked
    - **Why:** Each action was applied to the observed UI state without enabling background indexing.
- **Root cause:** The smoke harness equated a rendered startup header with editor focus.
- **Resolution:** Corrected the temporary smoke sequence; no application behavior was changed. Failed captures and fresh successful evidence were retained separately, and only the helper's owned terminal server was removed.
- **Verification:** All three packaged variants passed TUI startup and clean exit outside the repository with private state, preserved HOME, and network/credential access denied.
- **Prevention/follow-up:** Test optional first-run dialogs explicitly, use their displayed cancellation controls, and verify focus before sending editor-specific keys.
- **Reusable learning:** A visible application header does not identify which component currently owns keyboard input.
- **References:** `README.md` (Dependency and install security); `packages/coding-agent/docs/usage.md`.
