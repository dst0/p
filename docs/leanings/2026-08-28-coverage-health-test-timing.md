# 2026-08-28 — Aggregate coverage health-test timing

- **Status:** Resolved
- **Task/context:** Re-running the repository-wide coverage gate after adding focused verification tests.
- **Unexpected observation or failure:** The aggregate coverage run reported a failure in the local `EmbeddingServerManager.waitUntilIdle` test even though the same three-test file passed repeatedly in isolation. The failure occurred at the 500ms overall test deadline while coverage instrumentation and preceding packages were active.
- **Evidence:** Aggregate coverage observed the first test taking 698ms and returning `false`; an isolated `npx vitest run --coverage test/embedding-server-idle.test.ts` completed all 3 tests in 253ms. The full non-coverage code-index package run also passed all 381 TypeScript tests and 92 Python tests.
- **Approaches tried:**
  - **Attempt:** Treat the result as an idle-state implementation regression.
    - **Outcome:** Did not work.
    - **Why:** The implementation and test passed in focused and full package runs outside aggregate scheduling pressure.
  - **Attempt:** Reproduce with coverage on the focused file.
    - **Outcome:** Worked.
    - **Why:** Focused instrumentation did not reproduce the aggregate event-loop delay.
- **Root cause:** The test used an unnecessarily tight 500ms overall deadline for an event-loop-sensitive local HTTP probe; aggregate instrumentation can delay the retry beyond that budget without changing idle semantics.
- **Resolution:** Increased only the test's overall wait budget to 2 seconds. The production polling behavior and its bounded request timeout remain unchanged.
- **Verification:** Focused non-coverage and coverage runs passed before and after the timeout adjustment; the subsequent authoritative aggregate coverage gate passed.
- **Prevention/follow-up:** Keep aggregate coverage timing margins separate from production liveness limits and inspect focused versus aggregate results before changing runtime code.
- **Reusable learning:** A local health probe test should tolerate instrumentation and aggregate event-loop scheduling; widen the test margin before altering correct production polling logic.
- **References:** `packages/code-index/test/embedding-server-idle.test.ts`; `packages/code-index/src/embed/server.ts`.
