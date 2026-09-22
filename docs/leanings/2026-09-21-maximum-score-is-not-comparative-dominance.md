# 2026-09-21 — Maximum score is not comparative dominance

- **Status:** Resolved
- **Task/context:** Certifying that P outperforms Pi and Kilo on the same model across four benchmark tasks.
- **Unexpected observation or failure:** The gate required P to reach every task maximum but allowed Pi and Kilo to reach the same maxima, so a complete tie could be published as a comparative win.
- **Evidence:** A self-consistent 36-cell fixture with equal maximum quality and equal efficiency passed both the in-memory evaluator and independent release-artifact validator before the regression was added.
- **Approaches tried:**
  - **Attempt:** Treat maximum P quality plus non-worse efficiency as sufficient.
    - **Outcome:** Did not work
    - **Why:** It proves an absolute result and a Pareto tie, not the requested strict quality advantage.
  - **Attempt:** Require strict mean normalized quality per task against each baseline while retaining per-cell P maxima and independent efficiency thresholds.
    - **Outcome:** Worked
    - **Why:** Different task score scales remain comparable, and every claimed task-level win has a strict quality margin over both baselines.
- **Root cause:** Absolute quality and comparative dominance were modeled as the same invariant.
- **Resolution:** Add strict per-task normalized quality gates for P versus Pi and P versus Kilo in both runtime certification and release-artifact revalidation.
- **Verification:** In-memory and release-flow tie regressions fail closed; ordinary fixtures now give baselines lower scores and pass only when P is strictly better.
- **Prevention/follow-up:** State absolute, comparative, and efficiency claims separately and give each an executable gate in every independent verifier.
- **Reusable learning:** A maximum score does not prove superiority when a baseline can tie it; comparative claims require an explicit strict comparison.
- **References:** `benchmarks/src/workloads/certification-paired-efficiency.ts`, `scripts/release-benchmark-artifact-validation.js`, `benchmarks/test/workloads/certification-paired-efficiency.test.ts`, `scripts/release-flow-certificate.test.js`
