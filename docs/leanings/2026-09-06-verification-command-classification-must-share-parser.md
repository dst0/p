# 2026-09-06 — Verification command classification must share the executable parser

- **Status:** Resolved
- **Task/context:** Real same-model agent pilot on the Qwen local orchestrator and completion verification in the coding-agent release branch.
- **Unexpected observation or failure:** A real P turn repeatedly ran a passing `node --import tsx --test ...` command, yet `ready_to_finish` said no successful current-revision test evidence existed. A local `node_modules/.bin/tsc --noEmit` was also not recognized as typecheck evidence.
- **Evidence:** The session recorded successful Node test output and a passing typecheck, while completion remained blocked. The readiness path used a broad `TEST_PATTERN` regular expression, but the evidence recorder and focused-command parser used the structured `commandContainsTestInvocation` parser. The old typecheck expression only matched bare `tsc` or package-manager forms.
- **Approaches tried:**
  - **Attempt:** Repeat the same successful test command and ask the model to retry completion.
    - **Outcome:** Did not work.
    - **Why:** Repetition could not change the mismatched classifier; the model spent 108 requests without terminal completion.
  - **Attempt:** Reuse the structured command parser in baseline, final, readiness, and requirement-guidance gates and extend typecheck matching to path-qualified executables.
    - **Outcome:** Worked.
    - **Why:** All gates now agree that an executable test invocation occurred, while quoted command text still does not count.
- **Root cause:** Independent lexical and structured classifiers disagreed about the same command.
- **Resolution:** Route every completion-evidence test decision through `commandContainsTestInvocation`; accept path-qualified `tsc` in the typecheck pattern; add regression tests for preloaded Node tests, stale evidence, quoted-command spoofing, and local tsc.
- **Verification:** Focused verification suites passed: 86 tests. The same source-safety suite passed on native case-sensitive APFS with 5 executed and 1 explicit skip. Pi completed the isolated calculator pilot 6/6. P's earlier pilot is retained as failed diagnostic evidence, not benchmark proof.
- **Prevention/follow-up:** Keep one executable-command parser as the authority for all test-evidence gates. Run real-agent pilots only after sandbox toolchain probes pass.
- **Reusable learning:** A model-facing completion contract must use the same parsed command identity at recording, selection, readiness, and finalization boundaries.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/test-command-invocation.ts`; `packages/coding-agent/test/task-verification-node-command-readiness.test.ts`.
