# 2026-08-31 — Benchmark seeds must use the live compiler identity

- **Status:** Resolved
- **Task/context:** Diagnose why a compiled project-instruction benchmark task completed its work but the outer validator rejected the retained cache evidence.
- **Unexpected observation or failure:** All ten prompt-projection hashes in the live cache differed from the certified seed receipt, even though the AGENTS source, compiler model, runtime, and disabled skill catalog were intended to be identical.
- **Evidence:** The validator reported `Seeded cell prompt projection authority changed`. The certified seed identity ended at the compiler contract revision, while live session cache identity also contained a `reasoning-control-sha256` component. A regression using the reasoning-aware identity failed before the fix with seed-helper exit code 86 and passed afterward.
- **Approaches tried:**
  - **Attempt:** Suspect live skill discovery because the seed materializer explicitly used an empty skill list.
    - **Outcome:** Did not work
    - **Why:** The benchmark command already passes `--no-skills`; both paths intentionally use an empty skill catalog.
  - **Attempt:** Compare the exact seed and live compiler-identity construction paths.
    - **Outcome:** Worked
    - **Why:** It exposed the omitted reasoning-control identity in certification while live session construction included it.
- **Root cause:** Benchmark certification and live session startup independently constructed compiler identities. Certification omitted the reasoning-control metadata hash, so live startup invalidated the provider-free seed and recompiled the project instructions.
- **Resolution:** Centralize model compiler-identity construction and validation, use the shared builder during certification, and require the reasoning-control hash when materializing a seed.
- **Verification:** The seed-to-live handoff regression passes 4/4, the compiler reasoning-control unit passes 6/6, the benchmark suite passes 336/336, `npm run check` passes, and the repository-wide non-e2e suite exits successfully after rebuilding the immutable runtime.
- **Prevention/follow-up:** Keep benchmark seed and live cache identities on the shared builder; reject identities with another contract revision, a missing hash, or trailing bytes.
- **Reusable learning:** Any precomputed cache authority must use the exact runtime identity builder, including model-control metadata, rather than reconstructing a shorter look-alike identity.
- **References:** `benchmarks/test/project-instructions/seed-materialization.test.ts`, `packages/coding-agent/test/project-instruction-compiler-reasoning-control.test.ts`
