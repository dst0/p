# 2026-09-12 — Certified runtime closure must be frozen

- **Status:** Resolved
- **Task/context:** Reviewing certified P, Pi, and Kilo benchmark identity guarantees.
- **Unexpected observation or failure:** Pi and Kilo identity covered only launcher bytes, while the launcher could import mutable sibling package code; P's probe still pointed at the live checkout.
- **Evidence:** Production command construction granted only launcher literals and the live probe path, while the candidate snapshot already contained the probe.
- **Approaches tried:**
  - **Attempt:** Hash launchers and recheck them after execution.
    - **Outcome:** Did not work
    - **Why:** It neither made script dependencies readable under sandbox nor prevented a mutable dependency closure.
  - **Attempt:** Copy complete package roots and the P probe into the candidate snapshot and hash the combined tree.
    - **Outcome:** Worked
    - **Why:** Every executed runtime file is immutable, readable inside one sandbox root, and covered by the final integrity recheck.
- **Root cause:** Executable identity was modeled as one file instead of the transitive runtime closure.
- **Resolution:** Certified setup snapshots Pi/Kilo package roots, rejects unfrozen script closures, rebinds the P probe, and recomputes the candidate hash.
- **Verification:** `certification-runtime-binding.test.ts` and `certification-frozen-probe.test.ts` mutate live sources and confirm execution remains frozen.
- **Prevention/follow-up:** Keep every certified executable dependency below the hashed candidate runtime.
- **Reusable learning:** A launcher hash is not a runtime identity; freeze and bind the complete executable closure.
- **References:** `benchmarks/src/workloads/certification-executable-snapshot.ts`, `benchmarks/src/workloads/certification-setup.ts`.
