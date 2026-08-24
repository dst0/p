# 2026-08-25 — Bounded shell wrappers must not own full-suite lifetimes

- **Status:** Resolved
- **Task/context:** Run the mandatory full non-e2e suite for the rc.36 bounded requirement-repair change.
- **Unexpected observation or failure:** Running `./test.sh` through the lean-ctx CLI exited 1 after 120 seconds even though every visible test summary was green, and the interrupted cleanup left the protected agent auth file at its `.bak` path.
- **Evidence:** The wrapper log ended with its 8 MB / 120 s truncation marker after green 61/61 release-script tests. The primary auth path was absent while the mode-`0600` backup remained intact. After restoring that exact backup, a direct `./test.sh` run completed with exit 0 and printed `Restored auth.json`.
- **Approaches tried:**
  - **Attempt:** Route the full suite through `lean-ctx -c './test.sh'` for automatic output compression.
    - **Outcome:** Did not work
    - **Why:** The wrapper's bounded lifetime was shorter than the legitimate suite runtime, so it interrupted the owning process and its cleanup trap.
  - **Attempt:** Run `./test.sh` directly while redirecting output to an active temporary log, inspect only bounded progress slices, then compress the closed log with Brotli Q6.
    - **Outcome:** Worked
    - **Why:** The test process owned its complete lifecycle while monitoring remained low-noise and the final closed artifact was still compressed.
- **Root cause:** A bounded output wrapper was incorrectly made the lifecycle owner of a suite that is expected to run longer than the wrapper's ceiling.
- **Resolution:** Restore the intact backup only because the primary auth file was absent, then rerun the suite directly with redirected output. Keep the live log uncompressed until process exit and Brotli-compress it afterward.
- **Verification:** The direct rerun exited 0; package tests, unit suites, benchmark tests, script tests, Python tests, and release-flow tests all reported zero failures. `/Users/dst/.p/agent/auth.json` exists at mode `0600`, `.bak` is absent, and the closed log is `/private/tmp/p-rc36-full-test.log.br`.
- **Prevention/follow-up:** Repository instructions now explicitly prohibit routing `./test.sh` through lean-ctx's bounded CLI wrapper and prescribe direct execution with a temporary active log.
- **Reusable learning:** Use compression wrappers to observe bounded commands, not to own a longer process lifecycle; redirect long-run output and compress only after closure.
- **References:** `AGENTS.md`, `test.sh`, `/private/tmp/p-rc36-full-test.log.br`
