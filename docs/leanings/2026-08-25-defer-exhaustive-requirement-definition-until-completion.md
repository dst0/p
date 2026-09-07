# 2026-08-25 — Defer exhaustive requirement definition until completion

- **Status:** Resolved
- **Task/context:** Improving the project-instructions benchmark after candidate 5.0.1-rc.36 regressed on the event-sourced inventory fixture.
- **Unexpected observation or failure:** The agent spent most of the task budget decomposing and repairing a large referenced specification before it could implement anything, then timed out with incomplete domain behavior.
- **Evidence:** The rc.36 task-3 run spent about 26 minutes accepting 65 requirements and stopped at the 40-minute hard limit with an 85/100 score. A focused live AI-unit using the same fixture reached a successful production write after one source-preparation call and made zero definition or repair calls when definition was deferred.
- **Approaches tried:**
  - **Attempt:** Require complete clause decomposition immediately after freezing referenced files.
    - **Outcome:** Did not work
    - **Why:** It protected source fidelity but placed a large model-generated audit on the implementation critical path, consuming most of the bounded runtime before useful code existed.
  - **Attempt:** Freeze authoritative source bytes before mutation and postpone only model-based decomposition until final evidence is ready.
    - **Outcome:** Worked
    - **Why:** Immutable snapshots preserve the original specification while the expensive atomic audit moves to the completion gate, where it can evaluate the implementation and evidence together.
- **Root cause:** The controller coupled two distinct safety concerns: capturing mutable external instructions before work and exhaustively proving every clause before work. Only source capture is time-sensitive; requirement decomposition is needed before completion, not before the first implementation step.
- **Resolution:** Keep `prepare_definition` as the pre-mutation source-freeze gate, reject `define` until `ready_to_finish` has accepted current evidence, revalidate all frozen sources before every mutation until requirements are fixed, and prioritize any active rejected-definition recovery over implementation guidance.
- **Verification:** The 56-file requirement-verification slice passes 410 tests, including a real mutation-revision lifecycle that rejects premature definition, blocks changed frozen sources after mutation, restores the exact bytes, and then accepts definition in the evidence-ready phase. The focused live AI-unit reached a production write without premature definition.
- **Prevention/follow-up:** Use a live AI-unit as an early liveness gate before binding a benchmark candidate, then run the paired benchmark only after focused tests, checks, reinstall, and full non-e2e tests pass.
- **Reusable learning:** Separate time-sensitive capture from expensive semantic audit: freeze mutable instruction sources before work, but perform exhaustive model decomposition at the latest safe gate.
- **References:** `packages/coding-agent/test/task-requirement-source-deferred-definition.test.ts`, `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-source-preparation.ts`, `benchmarks/results/2026-08-24T23-57-10-900Z-v5.0.1-rc.36-project-instructions-paired/`
