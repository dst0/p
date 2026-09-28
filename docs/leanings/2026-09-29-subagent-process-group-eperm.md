# 2026-09-29 — Permission denied still means a process group exists

- **Status:** Resolved
- **Task/context:** Investigate a full-suite timeout in subagent process-tree cancellation.
- **Unexpected observation or failure:** A detached child closed, but the cancellation promise did not settle before its 15-second test timeout.
- **Evidence:** The full test log recorded an uncaught `kill EPERM` from `processTreeIsAlive` in an escalation timer. A focused regression reproduced the throw before the fix.
- **Approaches tried:**
  - **Attempt:** Rerun the existing process-tree test in isolation.
    - **Outcome:** Partial.
    - **Why:** It passed without reproducing the permission boundary, but did not exercise the recorded error path.
- **Root cause:** The liveness probe treated only `ESRCH` as an expected result and rethrew `EPERM`, leaving the cancellation flow unsettled.
- **Resolution:** Treat `EPERM` from the zero-signal group probe as alive, preserving conservative force-settle behavior; continue to rethrow unexpected errors.
- **Verification:** A focused test with a real detached child and an injected `EPERM` probe failed before the fix and passed afterward; the existing cancellation tests also passed.
- **Prevention/follow-up:** Keep explicit zero-signal permission behavior in process-tree tests and verify the full suite under load.
- **Reusable learning:** A zero-signal `EPERM` is evidence of an existing but inaccessible process, not an exception that may escape an asynchronous cleanup timer.
- **References:** `packages/coding-agent/examples/extensions/subagent/runner.ts`, `packages/coding-agent/test/subagent-runner-process-tree.test.ts`.
