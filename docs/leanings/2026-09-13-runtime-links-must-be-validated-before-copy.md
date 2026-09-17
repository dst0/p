# 2026-09-13 — Runtime links must be validated before copy

- **Status:** Resolved
- **Task/context:** Freezing external Pi and Kilo package runtimes for certified execution.
- **Unexpected observation or failure:** Dereferencing a package tree before checking links could copy external secret bytes into the snapshot and reject them only afterward.
- **Evidence:** A fixture linked a package dependency to an outside secret file; post-copy containment detected the link too late because dereference had already materialized its bytes.
- **Approaches tried:**
  - **Attempt:** Copy with dereference and inspect the destination.
    - **Outcome:** Did not work
    - **Why:** The forbidden data had already crossed the trust boundary.
  - **Attempt:** Traverse links before destination creation and require exact provenance for exceptions.
    - **Outcome:** Worked
    - **Why:** Rejected targets never enter the snapshot and accepted targets become regular, hashed files.
- **Root cause:** Containment was verified after the security-sensitive copy operation.
- **Resolution:** Snapshot creation rejects external links before copy unless their package-relative link and resolved regular-file target are explicitly allowlisted; accepted provenance hashes the actual regular file materialized in the snapshot.
- **Verification:** `certification-runtime-binding.test.ts` proves rejected secret bytes never create a destination and accepted exceptions record the copied file's exact SHA-256 provenance.
- **Prevention/follow-up:** Validate every source-tree boundary before a recursive or dereferencing copy.
- **Reusable learning:** Post-copy validation cannot undo secret ingestion; inspect link provenance first.
- **References:** `benchmarks/src/workloads/certification-executable-snapshot.ts`
