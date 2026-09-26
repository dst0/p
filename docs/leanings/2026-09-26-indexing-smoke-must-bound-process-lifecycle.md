# 2026-09-26 — Indexing smoke must bound its process lifecycle

- **Status:** Resolved
- **Task/context:** Reinstall the local P CLI and code-indexing service after merging the startup-readiness fix.
- **Unexpected observation or failure:** The installer printed a successful real semantic-search result and an HTTP 500 warning while removing the temporary collection, then waited indefinitely for its smoke child to exit.
- **Evidence:** The installer was blocked in a synchronous child invocation without a timeout. The smoke child remained alive after the search success line; terminating only that verified child let the installer exit. A later isolated smoke run and full reinstall completed successfully. These observations do not establish which cleanup await kept the first smoke child alive.
- **Approaches tried:**
  - **Attempt:** Wait for the first smoke child to finish after search success.
    - **Outcome:** Did not work
    - **Why:** The child stayed alive well beyond its expected runtime and the parent had no deadline.
  - **Attempt:** Re-run the real smoke and reinstall under an external process-group deadline.
    - **Outcome:** Worked
    - **Why:** Both completed with real search results and the indexing service restarted successfully.
- **Root cause:** The installer used an unbounded synchronous child-process call for semantic verification. The exact cause of the first child's post-search stall remains unproven.
- **Resolution:** Use the existing bounded process-group runner with a generous finite deadline; fail installation on timeout or nonzero exit and terminate descendants with inherited pipes.
- **Verification:** A regression reproduces a smoke that prints success but hangs with an inherited-pipe descendant, then asserts a bounded failure and both processes inactive. A positive fixture verifies successful exit and environment propagation. `npm run check`, `npm run test:scripts`, full `./test.sh`, and `./reinstall.sh` passed; the real reinstall returned one semantic-search result and a ready daemon.
- **Prevention/follow-up:** Keep child-process lifecycle bounds around installer verification even if the smoke script's own cleanup improves. Investigate a repeated post-search HTTP 500 separately if it recurs.
- **Reusable learning:** A success line from a subprocess is not proof it has exited; bound and verify the whole subprocess lifecycle before proceeding with service installation.
- **References:** `scripts/install-indexing-service.js`, `scripts/indexing-semantic-smoke-runner.js`, `scripts/indexing-semantic-smoke-runner.test.js`
