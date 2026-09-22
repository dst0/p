# 2026-09-21 — Release benchmarks need independent artifact and base validation

- **Status:** Resolved
- **Task/context:** Making a 36-cell certified benchmark a mandatory input to the authorized major release.
- **Unexpected observation or failure:** A self-declared passing artifact with all canonical cell identities but no runtime metrics could be persisted, and a long benchmark could start from a dirty, divergent, or stale `origin/main` state only to fail at publication.
- **Evidence:** A failing regression persisted 36 rows containing only run, agent, and task. Separate Git fixtures reproduced dirty state, local divergence, and an unseen remote main advance.
- **Approaches tried:**
  - **Attempt:** Trust the runner's in-memory `passed` result and validate only artifact hashes and matrix cardinality.
    - **Outcome:** Did not work
    - **Why:** The persistence API remained callable with structurally incomplete synthetic evidence.
  - **Attempt:** Revalidate every stored row, canonical score, model identity, token/cost value, and paired threshold independently, while fetching and checking exact `origin/main` before work and again before atomic receipt publication.
    - **Outcome:** Worked
    - **Why:** Both the expensive execution base and the durable artifact are validated at their own trust boundaries.
- **Root cause:** Publication reused upstream conclusions instead of reconstructing the evidence it was certifying, and repository freshness was checked too late.
- **Resolution:** Add an independent release-artifact validator, require canonical 3 by 4 by 3 runtime evidence, share one score policy, fetch `origin/main` at preflight and publication, and bind the benchmark receipt into the release certificate.
- **Verification:** Sparse passing artifacts are rejected; complete synthetic matrices pass; dirty/divergent/stale-base fixtures fail; the full release-flow suite passes through exact major authorization.
- **Prevention/follow-up:** Keep every new scoring or runtime field in the independent validator and release-input hash scope. Run the live matrix only from a clean fetched exact-main worktree.
- **Reusable learning:** A release gate must independently reconstruct both the execution base and the stored evidence; hashes and upstream booleans do not validate semantics.
- **References:** `scripts/release-benchmark-artifact-validation.js`, `scripts/release-benchmark-certification.js`, `benchmarks/src/workloads/release-benchmark-base.ts`, `scripts/release-flow-certificate.test.js`
