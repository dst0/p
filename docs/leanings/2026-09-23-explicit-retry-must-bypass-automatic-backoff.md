# 2026-09-23 — Explicit user retries must bypass automatic failure backoff

- **Status:** Resolved
- **Task/context:** Follow-up review of the compiled-instruction fallback change ([2026-09-23 compiler fallback](2026-09-23-compiler-fallback-must-degrade-not-block.md)). The fallback notice told users that a `/reload` would compile the rules again.
- **Unexpected observation or failure:** Within five minutes of a compiler failure, `/reload` never contacted the compiler. `prepareProjectInstructions` reused the cached failure diagnostic (`processor.ts` backoff check), and reload reset the notice state, so the user saw the same fallback notice as if a retry had happened.
- **Evidence:** `packages/coding-agent/test/suite/project-instruction-compiler-backoff.test.ts` drives the production model compiler through the faux provider with the default backoff. With `do_reload` calling a plain `refresh()`, both tests failed at the reload assertion: the provider call log stayed `["compiler"]` instead of `["compiler", "compiler"]`, and `["compiler", "task"]` instead of `["compiler", "task", "compiler"]`.
- **Approaches tried:**
  - **Attempt:** Test backoff with SDK custom compilers.
    - **Outcome:** Did not work
    - **Why:** `createSessionProjectInstructionController` disables the backoff whenever a custom compiler is supplied, so those tests never exercised the production backoff wiring.
  - **Attempt:** Add `refresh({ retryFailedCompilation: true })` for `/reload` only, and give the suite harness a controller factory that runs the default model compiler against the faux provider.
    - **Outcome:** Worked
    - **Why:** Automatic refreshes keep the protective five-minute window, while the explicit user action always reaches the endpoint. A failed attempt restarts the window.
- **Root cause:** The backoff could not tell automatic refreshes from an explicit user retry, and the only backoff tests bypassed the production wiring.
- **Resolution:** `ProjectInstructionController.refresh` accepts `retryFailedCompilation`. `do_reload` sets it, and every other caller keeps the backoff. Recovery after an announced fallback now emits a one-line `project_instructions_restored` notice.
- **Verification:** The backoff test covers an automatic refresh within the window (no call), `/reload` within the window (one call), and an automatic refresh just before (no call) and just after (call) the documented five-minute expiry. It also covers `/reload` recovery with a single restored notice.
- **Prevention/follow-up:** Test rate limits and backoffs through the production construction path, not through an override that disables them.
- **Reusable learning:** An automatic backoff must never swallow an explicit user retry; the user-facing retry path should always perform one real attempt and report its actual result.
- **References:** `packages/coding-agent/src/core/project-instructions/controller.ts`, `packages/coding-agent/src/core/agent-session/agentsession-methods/runtime-build.ts`, `packages/coding-agent/test/suite/project-instruction-compiler-backoff.test.ts`, `packages/coding-agent/test/suite/harness.ts`
