# 2026-09-12 — Certified deadline must cover the full matrix

- **Status:** Resolved
- **Task/context:** Normalizing the global deadline for a 36-cell minimum certified benchmark.
- **Unexpected observation or failure:** The documented default global deadline was much shorter than the sum of canonical cell budgets and preflights.
- **Evidence:** Argument normalization retained the exploratory 900-second default for certified mode.
- **Approaches tried:**
  - **Attempt:** Document a larger fixed number.
    - **Outcome:** Did not work
    - **Why:** Runs, task timeouts, minimum overrides, and selected startup probes change the required bound.
  - **Attempt:** Derive the minimum from the normalized execution matrix and reject smaller explicit values.
    - **Outcome:** Worked
    - **Why:** The deadline remains consistent with the actual work requested.
- **Root cause:** One exploratory default was reused for a fundamentally larger certified schedule.
- **Resolution:** Certified normalization derives its minimum from every cell plus per-agent preflight, Kilo startup, fixed setup, and per-cell orchestration allowances.
- **Verification:** `certification-runtime-budget.test.ts` checks every component exactly, scaling, and an inadequate explicit override.
- **Prevention/follow-up:** Reuse the derivation whenever the canonical matrix or startup phases change.
- **Reusable learning:** A global safety deadline must be computed from the normalized schedule it governs.
- **References:** `benchmarks/test/workloads/certification-runtime-budget.test.ts`
