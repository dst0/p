# 2026-08-17 — Full-workspace coverage must use the sanitized root launcher

- **Status:** Resolved
- **Task/context:** Recomputing changed-line coverage for the completion and release certificate implementation.
- **Unexpected observation or failure:** Direct package-level coverage commands activated provider e2e tests from ambient authentication and endpoint variables, producing unrelated network failures instead of the intended unit-only evidence.
- **Evidence:** The direct AI workspace run attempted provider requests and reported authorization failures, while `npm run test:unit:coverage` moved the local auth file aside, removed provider credentials through `test.sh`, and completed every workspace test suite successfully.
- **Approaches tried:**
- **Attempt:** Run each workspace `test:coverage` script directly in parallel.
- **Outcome:** Did not work
- **Why:** Package scripts do not provide the root launcher's authentication isolation and can activate environment-gated e2e cases.
- **Attempt:** Run the root `npm run test:unit:coverage` command and inspect the retained log when the compression wrapper reached its capture limit.
- **Outcome:** Worked
- **Why:** The repository launcher sanitizes provider state before invoking the same workspace coverage scripts and restores it afterward.
- **Root cause:** The direct commands bypassed the repository's unit-test environment boundary; the failures were test-selection errors, not product regressions.
- **Resolution:** Discard direct workspace coverage results and use only the root sanitized launcher for full-workspace coverage evidence.
- **Verification:** All five workspace coverage suites completed successfully, including 260 coding-agent files and 2,221 passing tests, before the changed-line checker reported 99.61% coverage.
- **Prevention/follow-up:** Keep full coverage behind `test.sh`; use package-level Vitest only for explicitly focused, known non-e2e files.
- **Reusable learning:** A package's coverage script is not necessarily a safe unit-test entrypoint; preserve the repository's environment-sanitizing root launcher whenever ambient provider configuration may exist.
- **References:** `test.sh`, `package.json`, `scripts/check-changed-coverage.js`
