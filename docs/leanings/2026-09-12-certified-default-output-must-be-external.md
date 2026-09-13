# 2026-09-12 — Certified default output must be external

- **Status:** Resolved
- **Task/context:** Exercising the documented certified benchmark command without optional output flags.
- **Unexpected observation or failure:** The default output was inside the live repository, which the certified containment assertion correctly rejects.
- **Evidence:** The documented command derived `benchmarks/results/<timestamp>` and then failed `assertBenchmarkContainment` before preflight.
- **Approaches tried:**
  - **Attempt:** Keep the normal benchmark default for certified mode.
    - **Outcome:** Did not work
    - **Why:** A benchmark workspace inside the live checkout invalidates the isolation proof.
  - **Attempt:** Create a private temporary output directory outside the repository.
    - **Outcome:** Worked
    - **Why:** It satisfies containment and the runner prints the exact path for retrieval.
- **Root cause:** Certified and exploratory modes shared a default that only exploratory mode can safely use.
- **Resolution:** Certified mode now creates a mode-0700 `p-certified-benchmark-*` directory unless `--output` is explicit.
- **Verification:** `certification-output-location.test.ts` proves the default is outside `repoRoot` and explicit paths remain authoritative.
- **Prevention/follow-up:** Validate documented zero-option paths against security preconditions.
- **Reusable learning:** Secure defaults must be executable defaults; documentation cannot repair an invalid runtime path.
- **References:** `benchmarks/src/workloads/benchmark-output.ts`.
