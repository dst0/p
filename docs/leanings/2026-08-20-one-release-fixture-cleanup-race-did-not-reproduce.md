# 2026-08-20 — One release-fixture cleanup race did not reproduce

- **Status:** Partial
- **Task/context:** Run the complete non-E2E unit gate after benchmark evidence
  hardening.
- **Unexpected observation or failure:** The first run passed 50 of 51 release
  regressions but one fixture cleanup raised `ENOTEMPTY` while removing its
  private temporary repository.
- **Evidence:** The failing assertion was cleanup after the expected pre-commit
  rejection, not the release-policy behavior under test. A complete rerun
  passed with authoritative exit status zero.
- **Approaches tried:**
  - **Attempt:** Treat the first aggregate exit as a benchmark-code failure.
    - **Outcome:** Rejected.
    - **Why:** The decisive stack was in temporary-directory removal after the
      policy assertion, outside every changed benchmark module.
  - **Attempt:** Rerun the entire canonical unit harness without changing the
    release fixture.
    - **Outcome:** Worked.
    - **Why:** All suites, including the same release regression and the new
      benchmark tests, completed successfully.
- **Root cause:** Unconfirmed; the one-time `ENOTEMPTY` indicates a late writer
  or filesystem cleanup race in the release fixture. There is not enough
  evidence to assign a code defect after one failure and one clean full rerun.
- **Resolution:** No release-test behavior was weakened or changed. The final
  gate uses the successful complete rerun, while the initial failure remains
  recorded as non-authoritative diagnostic evidence.
- **Verification:** `npm run test:unit` completed with exit status zero on the
  full rerun; focused benchmark tests also pass independently.
- **Prevention/follow-up:** If this cleanup failure recurs, capture the exact
  remaining directory entries and owning processes before retrying, then add a
  focused lifecycle regression instead of broad retry logic.
- **Reusable learning:** Separate an assertion failure from teardown failure,
  but require a complete clean rerun before treating a one-time cleanup race as
  non-blocking.
- **References:** `scripts/release-flow-certificate.test.js`, `test.sh`
