# 2026-09-21 — Model alias parity does not prove request parity

- **Status:** Resolved
- **Task/context:** Comparing P, Pi, and Kilo on the same backend model in a release-certified benchmark.
- **Unexpected observation or failure:** Matching the reported model ID did not prove that P and Kilo used the same endpoint, request API, context/output limits, reasoning mode, tool capability, modalities, or generation options.
- **Evidence:** Focused regressions kept the alias constant while changing endpoint, limits, reasoning, tool use, modalities, and temperature; each mismatch had to fail closed.
- **Approaches tried:**
  - **Attempt:** Require equal requested and observed model names.
    - **Outcome:** Did not work
    - **Why:** Different client configuration can produce materially different requests under the same alias.
  - **Attempt:** Snapshot raw configs privately, compare a normalized semantic projection, and publish only a stable aggregate hash.
    - **Outcome:** Worked
    - **Why:** Runtime parity is checked without retaining endpoints, credentials, or raw private configuration in public artifacts.
- **Root cause:** Provider identity and request configuration were conflated into one model-name string.
- **Resolution:** Give P and Pi byte-identical model snapshots and Unlimited private run-budget profiles; validate endpoint identity, adapter/API semantics, limits, capabilities, modalities, and generation parameters across the shared Pi/P projection and Kilo; bind the request and resource policy with raw-input hashes and recheck it before publication.
- **Verification:** JSONC parity passes; every semantic mismatch fails; raw-input mutation invalidates recheck; malformed configuration errors do not disclose embedded secret text.
- **Prevention/follow-up:** Extend the normalized projection whenever any client adds a request- or resource-affecting option, and prove the live selected configs before running the 36-cell matrix.
- **Reusable learning:** Equal aliases and response model IDs are necessary but not sufficient; fair agent comparisons require parity of the request-affecting configuration.
- **References:** `benchmarks/src/workloads/certification-model-config-validation.ts`, `benchmarks/src/workloads/certification-model-config.ts`, `benchmarks/test/workloads/certification-model-config.test.ts`
