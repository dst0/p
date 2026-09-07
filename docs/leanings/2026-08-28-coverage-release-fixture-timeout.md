# 2026-08-28 — Release fixture timeout under coverage

- **Status:** Resolved
- **Task/context:** Running the repository-wide `./test.sh test:coverage` gate after adding focused coverage tests.
- **Unexpected observation or failure:** The aggregate coverage run terminated in `release-receipt-verification.test.js` when a valid fixture release exceeded the 30-second child-process timeout. The same release fixture completed successfully outside coverage.
- **Evidence:** The closed coverage log showed `runFixtureRelease` returning `status: null` during the annotated-tag test; the fixture's release subprocess had reached the atomic push step. A standalone code-index and focused release run were otherwise green.
- **Approaches tried:**
  - **Attempt:** Treat the failure as a product or release-script regression.
    - **Outcome:** Did not work.
    - **Why:** The failure was confined to the test fixture timeout while coverage instrumentation and the aggregate suite were active.
  - **Attempt:** Reproduce the same fixture test outside coverage.
    - **Outcome:** Worked.
    - **Why:** The release flow completed within the normal non-instrumented run.
- **Root cause:** `runFixtureRelease` used a 30-second timeout that was too short for instrumented release-audit fixtures under aggregate coverage.
- **Resolution:** Increased the fixture subprocess timeout to 120 seconds, preserving a finite bound while allowing the certified release flow to complete under coverage.
- **Verification:** The failure was reproduced in the coverage log; standalone release/code-index tests passed, and the subsequent authoritative full coverage gate passed.
- **Prevention/follow-up:** Keep coverage runs on the direct launcher and retain the compressed closed log; rerun the authoritative coverage gate before committing.
- **Reusable learning:** Test-process timeouts must include instrumentation and aggregate-suite overhead; a `null` child status at a valid subprocess boundary indicates timeout, not necessarily a product failure.
- **References:** `scripts/release-flow-test-fixture.js`; `scripts/release-receipt-verification.test.js`.
