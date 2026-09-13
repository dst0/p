# 2026-09-12 — Runtime budget metadata must be cycle-free

- **Status:** Resolved
- **Task/context:** Deriving certified runtime budgets from canonical task timeouts.
- **Unexpected observation or failure:** Importing the initialized task registry into argument normalization created an ESM cycle that failed fixture characterization before tests ran.
- **Evidence:** The full benchmark suite failed with `Cannot access 'durableWorkflowTask' before initialization`; the focused fixture reproduced it.
- **Approaches tried:**
  - **Attempt:** Read timeout values from initialized benchmark task objects inside option parsing.
    - **Outcome:** Did not work
    - **Why:** Task verification imports runner options, closing a runtime cycle through the registry.
  - **Attempt:** Place canonical timeout metadata in the dependency-leaf task-definition module.
    - **Outcome:** Worked
    - **Why:** Both task construction and budget derivation share one source without importing initialized task entities.
- **Root cause:** Configuration normalization depended on a runtime registry whose task modules already depended on normalization utilities.
- **Resolution:** Canonical timeout metadata now lives in a cycle-free leaf and task entities reference it.
- **Verification:** `fixture-characterization.test.ts` and `certification-runtime-budget.test.ts` pass together and in the full suite.
- **Prevention/follow-up:** Keep parser-time policy metadata in leaf modules that contain no initialized task imports.
- **Reusable learning:** Shared metadata should sit below both configuration and runtime entities in the import graph.
- **References:** `benchmarks/src/workloads/task-definition.ts`
