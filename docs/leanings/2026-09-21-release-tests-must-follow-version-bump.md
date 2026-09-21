# 2026-09-21 — Release tests must follow the lockstep version bump

- **Status:** Resolved
- **Task/context:** Run the full protected-branch CI after publishing the certified `v5.0.1` release.
- **Unexpected observation or failure:** The release workflow passed build and check but failed one authorization test because it expected the pre-release `0.4.224` snapshot and target `0.5.0`.
- **Evidence:** GitHub Actions job `106205086614` reported `Release target 0.5.0 must be greater than current version 5.0.1` in `scripts/version-bump-authorization.test.js`.
- **Approaches tried:**
  - **Attempt:** Treat the failure as an unrelated CI flake.
    - **Outcome:** Did not work
    - **Why:** The failure is deterministic whenever the repository's lockstep version advances beyond the literals in the test.
  - **Attempt:** Derive the snapshot tag and next target from the current root package version.
    - **Outcome:** Worked
    - **Why:** The same release transaction semantics are exercised for every released lockstep version without stale literals.
- **Root cause:** A release authorization regression test encoded the previous version and next target instead of reading the current release baseline.
- **Resolution:** Keep the fixture's historical setup intact, but tag the copied current snapshot with the live root version and exercise its next patch version.
- **Verification:** The targeted authorization test passes locally against `5.0.1`; the full CI rerun is the final gate.
- **Prevention/follow-up:** Treat release-version literals in tests as candidates for dynamic derivation whenever the repository performs lockstep releases.
- **Reusable learning:** Release transaction tests must derive their current and next versions from the checked-out release baseline, or the first release after a bump will fail before publication.
- **References:** `scripts/version-bump-authorization.test.js`, `scripts/release-target-policy.js`, GitHub Actions job `106205086614`
