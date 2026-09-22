# 2026-09-21 — Private certification evidence needs projection before cleanup

- **Status:** Resolved
- **Task/context:** Publishing release benchmark evidence while removing evaluator, candidate, model-configuration, and parity-receipt state.
- **Unexpected observation or failure:** The public result document embedded the full in-memory harness binding, including private temporary paths. Separately, finalization deleted the bound augmented instructions before the final integrity recheck, making every otherwise successful release publication fail.
- **Evidence:** A public-evidence regression found private paths in the unprojected binding. A failing finalization regression deleted `instructions/AGENTS.md` and then reproduced the bound-file recheck failure.
- **Approaches tried:**
  - **Attempt:** Apply generic path replacement to the whole private binding and recheck after all cleanup.
    - **Outcome:** Did not work
    - **Why:** Unknown temporary roots were not all covered, and intentional cleanup destroyed evidence the recheck still needed.
  - **Attempt:** Publish an explicit hash-and-version projection, then recheck after process/resource cleanup but before receipt sanitization and frozen-state disposal.
    - **Outcome:** Worked
    - **Why:** Public artifacts retain auditable identity without private locations, and the final recheck observes the last valid immutable state.
- **Root cause:** Private runtime objects were reused as public evidence, and all cleanup operations were treated as commutative even though sanitization intentionally invalidates bound paths.
- **Resolution:** Project certification bindings to safe hashes, versions, and receipts; validate the harness before deleting augmented instructions; always sanitize and dispose even on recheck failure; publish only after every cleanup succeeds.
- **Verification:** The public projection excludes candidate, evaluator, and configuration paths. The setup-to-publication integration test reaches default Brotli receipt persistence on success and suppresses it after cleanup failure.
- **Prevention/follow-up:** Treat each finalizer action as an ordered state transition and add integration coverage whenever a new private artifact joins the harness binding.
- **Reusable learning:** Never serialize a private runtime object directly, and perform the last integrity check immediately before the first intentional operation that destroys bound evidence.
- **References:** `benchmarks/src/workloads/benchmark-evidence-publication.ts`, `benchmarks/src/workloads/benchmark-run-finalization.ts`, `benchmarks/test/workloads/certified-release-pipeline.test.ts`
