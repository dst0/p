# 2026-09-28 — Certified candidates must not inherit caller secrets

- **Status:** Resolved
- **Task/context:** Run P, Pi, and Kilo in contained benchmark subprocesses.
- **Unexpected observation or failure:** Certified commands inherited unrelated caller credentials and a caller-controlled binary search path.
- **Evidence:** Sentinel-secret and unsafe-`PATH` regressions failed before the environment change and passed afterward.
- **Approaches tried:**
  - **Attempt:** Reuse the ordinary benchmark environment sanitizer.
    - **Outcome:** Did not work.
    - **Why:** It removed Git-specific variables but retained unrelated credentials and paths.
- **Root cause:** Certified mode initially reused a broad ambient process environment.
- **Resolution:** Construct an explicit small environment with a fixed binary path, private HOME and temporary directory, and no inherited provider credentials. The parent proxy retains the canonical provider key.
- **Verification:** `certified-agent-environment.test.ts` checks P, Pi, Kilo, and model-resolution commands; `certified-agent-auth-isolation.test.ts` checks private auth copies.
- **Prevention/follow-up:** Keep new candidate environment variables opt-in and test credential sentinels.
- **Reusable learning:** A sandbox filesystem policy does not sanitize process environment; build the latter from an allowlist.
- **References:** `benchmarks/src/harness/certified-candidate-environment.ts`, `benchmarks/test/workloads/certified-agent-environment.test.ts`.
