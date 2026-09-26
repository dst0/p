# 2026-09-26 — Startup deadlines must reach the real session path

- **Status:** Resolved
- **Task/context:** Bound cold compiled project-instruction startup without changing task-model thinking or benchmark conditions.
- **Unexpected observation or failure:** CLI parsing and direct controller tests looked correct, but a real CLI session still had no deadline.
- **Evidence:** The new SDK and runtime-factory regressions failed before the fix: a 10 ms SDK deadline produced a compiled artifact after a 150 ms compiler call, and the factory omitted a configured three-second value. Both passed after the option was forwarded through the factory, services, SDK, and controller.
- **Approaches tried:**
  - **Attempt:** Test the controller alone.
    - **Outcome:** Partial
    - **Why:** It bypassed the production CLI-to-SDK option chain.
  - **Attempt:** Exercise both the public SDK and runtime factory with focused regressions.
    - **Outcome:** Worked
    - **Why:** These tests cross the two missing boundaries.
- **Root cause:** The partial implementation passed the deadline into internal controller options but omitted the runtime-factory and SDK links.
- **Resolution:** Forward the deadline at every real session boundary; default CLI startup to 12 seconds, preserve `0` for full provider timeout, and keep benchmark probes at `0`.
- **Verification:** Focused SDK, runtime-factory, controller, CLI, and benchmark command tests, full `./test.sh`, `npm run check`, and `./reinstall.sh` pass. A controlled tmux run of installed p on a real local model reached fallback, wrote a temporary file through the agent, and verified its bytes.
- **Prevention/follow-up:** Test new startup options at both the public API and the CLI factory, not only at a directly constructed controller.
- **Reusable learning:** A timeout is not operational until its value is proven to reach the side effect it is supposed to bound.
- **References:** `packages/coding-agent/test/project-instruction-startup-sdk.test.ts`, `packages/coding-agent/test/runtime-factory.test.ts`, `packages/coding-agent/docs/project-instructions.md`
