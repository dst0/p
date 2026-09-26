# 2026-09-26 — Compiler cancellation must own the entire call lifetime

- **Status:** Resolved
- **Task/context:** Review the new cold-start compiler deadline and its abort signal under success, timeout, and pre-cancelled callers.
- **Unexpected observation or failure:** A timed-out call could still start provider work after slow authentication; successful calls retained abort listeners; an already-aborted signal still invoked a custom compiler.
- **Evidence:** Three focused regressions failed before the corresponding fixes: delayed auth triggered a model call after fallback, `removeEventListener` was never called, and a pre-aborted parent signal invoked the compiler once.
- **Approaches tried:**
  - **Attempt:** Rely on `Promise.race` to reject the caller.
    - **Outcome:** Partial
    - **Why:** It bounds the caller wait but does not stop code after an awaited authentication lookup or release listeners.
  - **Attempt:** Check cancellation before compiler invocation and after auth, propagate the signal to the provider, and remove listeners in `finally`.
    - **Outcome:** Worked
    - **Why:** Both the visible wait and late side effects now observe the same cancellation state.
- **Root cause:** Cancellation was treated as a return-time concern rather than an end-to-end call-lifetime contract.
- **Resolution:** Guard pre-aborted calls, recheck after auth, send the signal to provider completion, and detach parent/effective listeners on every terminal path.
- **Verification:** Focused cancellation, auth-race, and startup fallback tests, full `./test.sh`, `npm run check`, and `./reinstall.sh` pass. The installed P completed a real local-model write task after startup fallback.
- **Prevention/follow-up:** For every awaited step before an external side effect, recheck cancellation and cover late resolution in a regression.
- **Reusable learning:** A bounded wait is not a cancelled operation unless every later side effect and listener lifetime is bounded too.
- **References:** `packages/coding-agent/src/core/project-instructions/compiler-runner.ts`, `packages/coding-agent/test/project-instruction-compiler-deadline.test.ts`, `packages/coding-agent/test/project-instructions-session-compiler.test.ts`
