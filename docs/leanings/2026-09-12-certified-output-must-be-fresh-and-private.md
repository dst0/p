# 2026-09-12 — Certified output must be fresh and private

- **Status:** Resolved
- **Task/context:** Hardening certified agent benchmark publication.
- **Unexpected observation or failure:** A caller could select a preseeded, permissive, or symlinked output tree and later publication could overwrite an existing result.
- **Evidence:** The regression accepted those roots and reused a precreated task-cell directory before the guard was added.
- **Approaches tried:**
  - **Attempt:** Validate only the final result filename.
    - **Outcome:** Did not work
    - **Why:** Untrusted content could already influence workspace setup earlier in the run.
  - **Attempt:** Establish ownership at the root, then create cells and publications exclusively.
    - **Outcome:** Worked
    - **Why:** Existing content is rejected before benchmark writes and later writes cannot silently replace it.
- **Root cause:** The output path was treated as a convenience directory rather than a certification trust boundary.
- **Resolution:** Certified roots must be absent or empty, non-symlink mode `0700` directories; ownership, cells, and results use exclusive private writes.
- **Verification:** `certification-output-location.test.ts` covers preseeded roots and cells, permissions, symlinks, and overwrite attempts.
- **Prevention/follow-up:** Keep every future certified publication path inside the owned private root and use no-overwrite creation.
- **Reusable learning:** Validate and exclusively claim the whole evidence tree before writing any certified artifact.
- **References:** `benchmarks/test/workloads/certification-output-location.test.ts`
