# 2026-09-27 — Relative agent directories must survive install cwd changes

- **Status:** Resolved
- **Task/context:** Review the centralized `~/.p/install` runtime before merging its PR.
- **Unexpected observation or failure:** A relative `P_CODING_AGENT_DIR` let the source installer acquire the indexing lock, but the staged-runtime child could not prove ownership of that lock.
- **Evidence:** The focused regression failed before the fix with `Indexing reinstall parent does not own the active lock`; the same source-to-candidate cwd transition passed after the path was normalized and exported.
- **Approaches tried:** First passed the relative override through unchanged; this failed because its meaning changed with the child's cwd. Resolving it once in the parent and exporting that absolute value kept both processes on one lock and agent directory. The test also needed to compare physical temp paths on macOS, where `/var` aliases `/private/var`.
- **Root cause:** The transaction kept its own `INDEXING_REINSTALL_AGENT_DIR` but did not export a cwd-independent `P_CODING_AGENT_DIR` to the delegated installer.
- **Resolution:** Resolve the agent directory to an absolute path at transaction start, export it for descendants, and use the resolved path for subsequent reinstall operations.
- **Verification:** `scripts/indexing-reinstall-lock.test.js` reproduces the failed parent/child handoff from different directories and passes after the fix. `npm run check`, `npm run test:scripts`, the full `./test.sh`, and the focused indexing-version test passed. Live reinstall and smoke results belong in the PR after they complete.
- **Prevention/follow-up:** Bind relative configuration paths before changing runtime cwd or delegating subprocesses; test the handoff, not only the path helper.
- **References:** `reinstall.sh`, `scripts/indexing-reinstall-transaction.sh`, `scripts/indexing-reinstall-lock.test.js`
