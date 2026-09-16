# 2026-09-17 — Platform-specific certified benchmark tests

- **Status:** Resolved
- **Task/context:** Validate the certified benchmark containment and frozen-runtime setup in PR #120 on the repository CI matrix.
- **Unexpected observation or failure:** The Linux CI runner reported three failures because certified setup tests expected `macOS sandbox-exec` to exist, while the production containment guard intentionally rejects non-macOS execution.
- **Evidence:** The benchmark suite passed locally on Darwin (485 passed). On Linux, `benchmarkSandboxExecutable()` returns `undefined` and `assertBenchmarkContainment()` raises `Certified benchmark mode requires containment via macOS sandbox-exec`; the failing tests were the containment success-path assertion and two frozen-setup tests.
- **Approaches tried:**
  - **Attempt:** Relax the production guard or emulate sandboxing on Linux.
    - **Outcome:** Did not work.
    - **Why:** That would invalidate the certified benchmark's fail-closed isolation guarantee.
  - **Attempt:** Make tests reflect the platform contract.
    - **Outcome:** Worked.
    - **Why:** The containment test now asserts fail-closed behavior when sandboxing is unavailable, and frozen-runtime setup tests run only on Darwin where the required primitive exists.
- **Root cause:** Test assumptions were platform-independent even though certified benchmark isolation is intentionally Darwin-only.
- **Resolution:** Added explicit non-Darwin expectations/skips in `benchmarks/test/workloads/certification-containment.test.ts` and `benchmarks/test/workloads/certification-frozen-probe.test.ts`; production isolation code remains unchanged.
- **Verification:** Targeted tests passed 5/5; full `npm run test:benchmarks` passed 485/485 locally; `npm run check` passed with exit 0.
- **Prevention/follow-up:** Keep platform-specific isolation tests explicit and retain a portable assertion for the non-Darwin fail-closed guard. CI must rerun before merge.
- **Reusable learning:** When a security or containment primitive is deliberately platform-bound, test both the supported behavior and the unsupported-platform refusal instead of assuming every CI runner provides the primitive.
- **References:** `benchmarks/src/harness/benchmark-isolation.ts`; `benchmarks/test/workloads/certification-containment.test.ts`; `benchmarks/test/workloads/certification-frozen-probe.test.ts`.
