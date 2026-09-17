# 2026-09-13 — Certification needs post-binding holdouts and bounded egress

- **Status:** Resolved
- **Task/context:** Preventing canonical-fixture answer hardcoding in certified agent comparisons.
- **Unexpected observation or failure:** Static hidden fixtures could be memorized, while broad network access allowed unrelated external coordination.
- **Evidence:** A canonical-only result passed static task checks; a generated challenge created after candidate binding made that result fail.
- **Approaches tried:**
  - **Attempt:** Treat the four canonical fixtures as universal capability proof.
    - **Outcome:** Did not work
    - **Why:** A fixed corpus cannot distinguish general behavior from fixture-specific hardcoding.
  - **Attempt:** Add sealed randomized variants after binding and deny network except explicit model endpoint ports.
    - **Outcome:** Partial
    - **Why:** The candidate cannot contain the future challenge value, but macOS `sandbox-exec` accepts wildcard remote hosts only and therefore cannot enforce a declared hostname.
- **Root cause:** Evaluation inputs were entirely fixed before candidate identity was frozen and containment granted broad outbound access.
- **Resolution:** Each task now includes a fresh post-binding digest challenge, while certified mode requires explicit endpoint declarations and grants only their unique TCP ports.
- **Verification:** `certification-holdout.test.ts` rejects canonical hardcoding; `certification-egress.test.ts` compiles the real host profile and verifies fail-closed endpoint configuration.
- **Prevention/follow-up:** This proves only generated benchmark variants. Any destination on an allowed port and a potentially adaptive endpoint remain explicit limitations; host-level restriction needs an externally verified firewall, proxy, or network namespace.
- **Reusable learning:** Generate discriminating evidence after candidate binding, and test containment policy against the real host parser before claiming destination-level egress restriction.
- **References:** `benchmarks/src/workloads/certification-holdout.ts`, `benchmarks/README.md`
