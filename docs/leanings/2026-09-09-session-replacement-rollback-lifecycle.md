# 2026-09-09 — Session replacement rollback lifecycle audit

- **Status:** Resolved
- **Task/context:** Audit session runtime replacement transactional rollback under failed `withSession(newSession)` (`packages/coding-agent/src/core/session-runtime-replacement.ts`).
- **Unexpected observation or failure:** An audit hypothesis queried whether a failed `withSession(newSession)` callback occurs after `session_shutdown` has disposed the previous session without a compensating lifecycle.
- **Evidence:** Code analysis and regression tests in `packages/coding-agent/test/agent-session-runtime-transaction.test.ts` disproved the hypothesis:
  1. `options.previous.session.dispose()` is executed *only* on successful completion after `withSession` resolves (line 74 of `session-runtime-replacement.ts`). It is never invoked before or during `withSession`.
  2. In the catch block (lines 76-96), `options.previous` state is restored, the replacement session is disposed, and `rebindSession` calls `options.rebind` and `options.previous.session.bindExtensions(options.host)`, which emits `session_start` for the original session.
  3. The test suite verifies the lifecycle sequence: `["shutdown:1", "start:2", "shutdown:2", "start:1"]`, confirming that the original session is restored to active service and is not disposed.
- **Approaches tried:**
  - **Attempt:** Trace and execute the transactional rollback test suite `agent-session-runtime-transaction.test.ts`.
    - **Outcome:** Defect disproven by evidence
    - **Why:** The previous session object remains active and undisposed throughout replacement execution. The `session_shutdown` hook emitted prior to replacement is an extension notification, not object disposal. On failure, rollback disposes the replacement and issues `session_start` to rebind extensions to the previous session.
- **Root cause:** Confusion between extension lifecycle notification (`session_shutdown`) and session instance disposal (`session.dispose()`).
- **Resolution:** No code modification required. The transactional replacement architecture correctly preserves the previous session and restores its extensions if `withSession` rejects.
- **Verification:** Ran focused test suite `packages/coding-agent/test/agent-session-runtime-transaction.test.ts` (5/5 tests passing).
- **Prevention/follow-up:** Documented lifecycle semantics to clarify the distinction between transient extension detachment and terminal session disposal.
- **Reusable learning:** Distinguish high-level event notifications (e.g. extension lifecycle) from physical resource disposal (e.g. `dispose()`); verify disposal call sites directly before assuming resource destruction.
- **References:** `packages/coding-agent/src/core/session-runtime-replacement.ts`, `packages/coding-agent/test/agent-session-runtime-transaction.test.ts`
