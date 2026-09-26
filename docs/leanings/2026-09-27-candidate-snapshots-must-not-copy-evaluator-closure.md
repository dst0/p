# 2026-09-27 — Candidate snapshots must not copy the evaluator closure

- **Status:** Resolved
- **Task/context:** Reviewing draft PR #138's certified P/Pi/Kilo benchmark before using it as release evidence.
- **Unexpected observation or failure:** The candidate runtime copied the benchmark runner's transitive import closure. That closure can include evaluator-only holdout-plan modules even when hidden fixture files are excluded.
- **Evidence:** Before the fix, `candidate-runtime-secrecy.test.ts` failed both checks: `run-agents.ts` was present in the candidate snapshot and a probe import into an evaluator module was accepted. The draft PR's runner closure reaches `certification-holdout-plan.ts` and its cases. Candidate containment allows reading its runtime snapshot, so copied plan source is visible to the agent.
- **Approaches tried:**
  - **Attempt:** Exclude only `hidden.test.ts` and `rubric.json` from fixture copies.
    - **Outcome:** Did not work
    - **Why:** Source imports are a separate path into evaluator logic.
  - **Attempt:** Seed candidate snapshots only from the project-instruction probe, then reject source imports outside `benchmarks/src/project-instructions`.
    - **Outcome:** Worked for this leak
    - **Why:** The runner and evaluator closure are no longer copied, and a future cross-directory probe import fails before a snapshot is published.
- **Root cause:** `createCandidateRuntimeSnapshot` reused `createRuntimeSnapshot` with only a fixture-scope option; source-closure selection remained the full runner closure.
- **Resolution:** Ordinary runner and candidate snapshots now have separate fixed entrypoints, with no public scope combination that can pair candidate fixtures with runner source. Candidate snapshots retain package runtime bytes, public task inputs, and the executable probe closure.
- **Verification:** The two regressions failed before the change and passed afterward; the containing runtime-snapshot tests passed 11/11. The real runner snapshot execution test also passed after the source-import parser was split into its own behavior-preserving module.
- **Prevention/follow-up:** Keep evaluator modules outside candidate-readable runtime and test both direct and transitive source-closure paths. This does not prove that a model endpoint cannot collude or that published package bytes cannot contain unrelated benchmark material; those are separate certification boundaries.
- **Reusable learning:** Snapshot secrecy must be enforced on every import closure, not just hidden fixture filenames or randomized challenge values.
- **References:** `benchmarks/src/harness/runtime-snapshot.ts`, `benchmarks/test/harness/candidate-runtime-secrecy.test.ts`, draft PR #138.
