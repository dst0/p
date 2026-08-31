# 2026-08-31 — Repair cardinality does not constrain repair kind

- **Status:** Resolved
- **Task/context:** Validate the experimental semantic-audit condition of the compiled project-instruction benchmark after implementation liveness had been restored.
- **Unexpected observation or failure:** The agent completed the implementation and its tests, then repeated unrelated one-item requirement replacements while the selected diagnostic required removing an invalid ignored-clause classification.
- **Evidence:** Candidate `5.0.1-rc.54` reached its first mutation in about 120 seconds and completed 46 mutations before the audit. Attempts 3 through 5 left `Source clause S2-C2 is not structurally informational.` unresolved. Each request contained exactly one repair item, so the cardinality guard passed, but the controller rejected the off-target repair and made no progress.
- **Approaches tried:**
  - **Attempt:** Rely on the existing exactly-one-item repair guard.
    - **Outcome:** Did not work
    - **Why:** Cardinality bounded the size of a repair without authorizing its semantic kind or target.
  - **Attempt:** Parse each controller-emitted invalid ignored-clause diagnostic into an exact ignored-clause removal target and reject every other repair kind.
    - **Outcome:** Worked
    - **Why:** The selected diagnostic now determines both the only permitted operation and the exact source clause it may affect.
- **Root cause:** The repair-target selector recognized only two ignored-clause diagnostic forms. Other forms fell through to the permissive `diagnostic_only` target, which accepts any singular repair even when it cannot resolve the selected diagnostic.
- **Resolution:** The selector now recognizes every current invalid ignored-clause diagnostic producer with exact anchored patterns. Those diagnostics permit only removal of the named ignored-clause classification; requirement replacement and removal of another clause are rejected.
- **Verification:** The regression was red when the live diagnostic selected `diagnostic_only`. The focused target, status, and monotonic-repair suites now pass 37 tests, including all current ignored-clause diagnostic forms, exact-target acceptance, wrong-clause rejection, requirement-replacement rejection, and fail-closed handling of unknown diagnostics.
- **Prevention/follow-up:** Keep controller diagnostics and repair-target parsing as one tested contract. Every new actionable diagnostic form must prove its exact permitted repair kind and target; unknown forms must remain non-actionable. Run a small installed live audit proof before another full benchmark candidate.
- **Reusable learning:** Bounding a repair to one item limits blast radius, but only controller-owned diagnostic-to-operation binding prevents one wrong item from looping forever.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-definition-repair-target.ts`, `packages/coding-agent/test/task-requirement-definition-ignored-clause-repair-target.test.ts`, `benchmarks/results/2026-08-31-v5.0.1-rc.54-all-four-three-condition-v1`
