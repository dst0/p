# 2026-09-13 — Certified output ancestry is a live trust boundary

- **Status:** Resolved
- **Task/context:** Preventing certified artifact writes after output-path replacement.
- **Unexpected observation or failure:** Initial mode and symlink checks did not stop a later root or ancestor replacement from redirecting publication outside the claimed tree.
- **Evidence:** Root-to-symlink and ancestor-to-symlink regressions redirected the same lexical output path to an external directory.
- **Approaches tried:**
  - **Attempt:** Validate the output directory only when claiming it.
    - **Outcome:** Did not work
    - **Why:** Pathname resolution can change during a long benchmark.
  - **Attempt:** Bind device, inode, and UID for the root and all ancestors and recheck before mutations.
    - **Outcome:** Worked
    - **Why:** Deterministic replacement is detected before external publication, including unsafe hard-linked targets.
- **Root cause:** Output ownership was treated as a startup fact rather than a continuously verified capability.
- **Resolution:** Certified writes, archives, hidden-verifier injection, sanitation, evidence copying, and publication revalidate bound ancestry plus nested target safety.
- **Verification:** `certification-output-identity.test.ts` covers root, ancestor, and hard-link substitution; `certification-hidden-verification-identity.test.ts` covers evaluator-file injection after test-directory replacement without external modification.
- **Prevention/follow-up:** Node lacks portable descriptor-relative `openat`; certification still requires excluding untrusted same-UID processes that can race between validation and the filesystem call.
- **Reusable learning:** Long-running evidence pipelines must revalidate the full output ancestry at each mutation boundary.
- **References:** `benchmarks/src/harness/certified-output-integrity.ts`, `benchmarks/README.md`
