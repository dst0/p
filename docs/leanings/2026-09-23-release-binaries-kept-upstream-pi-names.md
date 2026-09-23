# 2026-09-23 — Release binaries kept upstream `pi` names after the fork rename

- **Status:** Resolved
- **Task/context:** Rename the GitHub release binaries of the `p` fork and make sure existing standalone installs can still find updates.
- **Unexpected observation or failure:** Release `v5.0.2` published `pi-<platform>.tar.gz|zip` archives containing a `pi` executable in a `pi/` wrapper directory. `scripts/local-release.js` hid the mismatch with a shim that copied `pi` to `p` and fell back to `pi-*` archive names. Standalone installs were told to update from `https://github.com/dst0/p-mono/releases/latest`, which returns 404; the repository is `dst0/p`.
- **Evidence:** `gh release view v5.0.2` listed six `pi-*` assets plus `SHA256SUMS`. `scripts/build-binaries.sh` and the `release_assets` list in `.github/workflows/build-binaries.yml` hard-coded `pi` names, and `gh api repos/dst0/p-mono` returns 404. Nothing in `packages/coding-agent/src` resolves release asset names. The `bun-binary` install method gets `getSelfUpdateCommandForMethod() === undefined` and only prints the releases-page URL.
- **Approaches tried:**
  - **Attempt:** Keep publishing both `pi-*` and `p-*` assets for compatibility.
    - **Outcome:** Rejected.
    - **Why:** No installed client looks up asset names, so dual assets would double release size and upload time with no consumer. Old releases keep their `pi-*` assets unchanged.
  - **Attempt:** Rename everything the build produces (`p-<platform>` archives, `p`/`p.exe` executable, `p/` tar wrapper), remove the local-release fallback, and fail when the build emits another name.
    - **Outcome:** Worked.
    - **Why:** Producer, publisher and local smoke flow now share one name, and a drift fails a test instead of shipping.
- **Root cause:** The fork inherited the upstream binary build unchanged. A compatibility shim in the local release flow masked the upstream names instead of fixing the producer.
- **Resolution:** Renamed the outputs in `scripts/build-binaries.sh` and `.github/workflows/build-binaries.yml`. Removed the `pi` fallback from `scripts/local-release.js`, which now fails when the build does not produce `p`. Fixed the standalone update URL in `packages/coding-agent/src/config/install-paths.ts`.
- **Verification:** `scripts/release-workflow.test.js` checks that the uploaded asset list equals the build script's platform list with `p-` names. `scripts/local-release-binary-entrypoint.test.js` proves the `p` binary ships and a leftover `pi` build is rejected; both fail against the previous files. `packages/coding-agent/test/bun-binary-update-instruction.test.ts` ties the update URL to `package.json` `repository.url`.
- **Prevention/follow-up:** Binaries already installed from `v5.0.2` still print the dead `p-mono` URL; only new builds carry the fix. Docs and `src/migrations.ts` still link to `dst0/p-mono` and need a separate cleanup.
- **Reusable learning:** When a fork renames its product, rename the artifact producer and cross-check producer and publisher lists in tests. Compatibility shims in downstream tooling hide the inconsistency instead of fixing it.
- **References:** `scripts/build-binaries.sh`, `.github/workflows/build-binaries.yml`, `scripts/local-release.js`, `scripts/release-workflow.test.js`, `scripts/local-release-binary-entrypoint.test.js`, `packages/coding-agent/test/bun-binary-update-instruction.test.ts`.
