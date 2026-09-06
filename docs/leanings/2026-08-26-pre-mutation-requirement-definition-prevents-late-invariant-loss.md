# 2026-08-26 — Pre-mutation requirement definition prevents late invariant loss

- **Status:** Resolved
- **Task/context:** Candidate `5.0.1-rc.41` task 3 validation of the project-instruction compiler and requirement-audit workflow.
- **Unexpected observation or failure:** The agent implemented and repeatedly tested a substantial solution before creating any authoritative requirement definition, then timed out with one non-obvious boundary guarantee still missing.
- **Evidence:** The legacy cell ran for 2,403,932 ms, reached 52/52 self-authored tests, recorded zero requirement definitions, and failed only the hidden check that removes exactly the final byte from a newline-terminated log.
- **Approaches tried:**
  - **Attempt:** Freeze referenced specifications before mutation but defer exhaustive definition until completion.
    - **Outcome:** Did not work
    - **Why:** Implementation and self-authored tests were guided by an incomplete mental decomposition; the authoritative clause audit arrived too late to influence the code or focused tests.
  - **Attempt:** Define one complete hash-bound requirement set before the first implementation mutation and preserve it across later mutations.
    - **Outcome:** Worked
    - **Why:** The existing mutation reset already preserves requirement identities and proof policies, so completion can reuse the same set without another decomposition pass.
- **Root cause:** Source freezing protected bytes but did not force the model to decompose every normative clause before choosing implementation and test cases.
- **Resolution:** New production mutations now fail closed until one complete requirement definition is accepted; focused baseline tests remain available. A persisted policy marker survives mutation and reopens the gate when a later direct user prompt changes requirements. It preserves liveness for already-mutated legacy sessions created under completion-time definition semantics: those states remain exempt until a real new requirement activates the marker, while restored revision-zero states use the new gate immediately.
- **Verification:** Direct-prompt and referenced-source regressions prove mutation is blocked before definition, accepted requirements survive mutation, and later user requirements re-block mutation until redefinition. The complete requirement-audit domain suite passes.
- **Prevention/follow-up:** Run a focused live AI-unit before another full benchmark, then require task 3 correctness before measuring efficiency or starting task 4.
- **Reusable learning:** Freeze authoritative sources and accept their complete atomic requirement decomposition before production implementation; completion-time decomposition cannot repair tests that were designed from a lossy interpretation.
- **References:** `benchmarks/results/2026-08-26-v5.0.1-rc.41-task3-paired-v2/`, `packages/coding-agent/test/task-requirement-source-pre-mutation-definition.test.ts`, `packages/coding-agent/test/task-requirement-direct-prompt-pre-mutation-definition.test.ts`, `docs/leanings/2026-08-25-defer-exhaustive-requirement-definition-until-completion.md`
