# 2026-09-05 — Explicit script suites need registration

- **Status:** Resolved
- **Task/context:** Adding focused Node regressions for indexing installer and reuse behavior before the release gate.
- **Unexpected observation or failure:** The new tests passed when invoked directly but were absent from the mandatory full test path.
- **Evidence:** `test.sh` invokes `npm run test:scripts`, whose `package.json` command enumerated script test files explicitly and did not include the new indexing tests.
- **Approaches tried:**
  - **Attempt:** Rely on Node test discovery after placing files beside other script tests.
    - **Outcome:** Did not work
    - **Why:** The parent command uses an explicit file list rather than a glob.
  - **Attempt:** Add each new script test to the parent command and run that parent suite.
    - **Outcome:** Worked
    - **Why:** The mandatory full path now reaches the regressions instead of only focused developer invocations.
- **Root cause:** File placement looked discoverable, but the repository intentionally uses an allowlisted script-test command.
- **Resolution:** Register the lock, reuse, and installer regressions in `test:scripts`.
- **Verification:** Focused tests pass and the parent command includes all three paths; the complete parent run remains a required pre-commit gate.
- **Prevention/follow-up:** Whenever a test is added under `scripts/`, inspect the root test command and update its explicit list in the same change.
- **Reusable learning:** Passing a focused test is not proof that CI or the mandatory suite executes it; verify the parent test graph.
- **References:** `package.json`, `test.sh`, `scripts/indexing-reinstall-lock.test.js`, `scripts/indexing-service-reuse.test.js`, `scripts/install-indexing-service.test.js`
