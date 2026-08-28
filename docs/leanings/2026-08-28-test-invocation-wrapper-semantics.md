# 2026-08-28 — Test evidence parsing must preserve wrapper semantics

- **Status:** Resolved
- **Task/context:** Hardened task-verification test-command classification and changed-line coverage tests.
- **Unexpected observation or failure:** Focused test evidence parsing treated `command -v`/`-V` lookups as executable tests, discarded `env -C` working-directory changes, ignored `python -m unittest`, and failed to match a root-level file with a `**/` glob.
- **Evidence:** Regressions reproduced with focused Vitest assertions before the production fix; the parser returned a broad JavaScript invocation for `command -v vitest`, no working directory for `env -C /repo npm test ...`, and `undefined` for `python -m unittest ...`. `test/**/*.test.ts` did not cover `test/parser.test.ts`.
- **Approaches tried:**
  - **Attempt:** Remove the failing assertions and keep the parser unchanged.
    - **Outcome:** Did not work.
    - **Why:** It would preserve false-positive or false-negative verification evidence.
  - **Attempt:** Add focused semantic regressions and fix the parser at its wrapper boundaries.
    - **Outcome:** Worked.
    - **Why:** Command-query options are no longer execution, environment directory changes remain part of invocation identity, unittest is recognized as a Python runner, and `**/` can match zero directories.
- **Root cause:** Wrapper parsing reduced commands to bare executable words without retaining query mode or execution context; glob translation encoded `**/` as a mandatory slash.
- **Resolution:** Added structured wrapper state, query-only rejection, environment working-directory propagation, unittest module recognition, and optional-directory glob translation.
- **Verification:** Focused Vitest suite passes 40/40 tests; Biome passes for the touched source and test files.
- **Prevention/follow-up:** Keep command classification tests semantic and include shell wrappers, query-only commands, environment directory changes, all supported Python runners, and both nested and root-level glob matches.
- **Reusable learning:** Verification evidence must model the command that actually ran—including wrappers, working directory, and runner semantics—not only the final executable token.
- **References:** `packages/coding-agent/test/task-verification-test-invocation-selection-semantics.test.ts`; `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/test-command-invocation.ts`; `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/test-invocation-selection.ts`
