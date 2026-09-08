# 2026-09-08 — Process budget is an initial override

- **Status:** Resolved
- **Task/context:** Review `--budget` behavior while switching sessions in a long-lived CLI process.
- **Unexpected observation or failure:** The process argument was reapplied by the runtime factory after every session replacement, overwriting resumed policies and leaking into later in-memory tasks instead of using the saved global default.
- **Evidence:** Runtime-factory regressions resumed a token-budget session under a request-budget process and created an in-memory task after an Unlimited override; both inherited the process policy before the fix.
- **Approaches tried:**
  - **Attempt:** Pass the parsed process override to every runtime construction.
    - **Outcome:** Did not work
    - **Why:** Session replacement reused launch arguments as if they were a switch command.
  - **Attempt:** Keep separate current-task and global-default policies, apply the override only when `sessionStartEvent` is absent, and reload the saved default for each replacement.
    - **Outcome:** Worked
    - **Why:** The launch target remains explicitly overridable while later resume targets retain their own ledger authority.
- **Root cause:** Initial-runtime options and replacement-runtime options were not distinguished.
- **Resolution:** Startup now returns distinct current and default policies. The CLI runtime factory scopes parsed `--budget` to initial construction and reads the current cwd's saved default before constructing a replacement task.
- **Verification:** `run-budget-startup-flow.test.ts` and `runtime-factory.test.ts` cover current/default separation, resumed-policy preservation, refreshed defaults, and in-memory new-task isolation.
- **Prevention/follow-up:** Process launch overrides must declare whether they apply once, to new sessions, or to every replacement.
- **Reusable learning:** Never silently replay an initial session override during an in-process session switch.
- **References:** `packages/coding-agent/src/main/runtime-factory.ts`, `packages/coding-agent/test/runtime-factory.test.ts`
