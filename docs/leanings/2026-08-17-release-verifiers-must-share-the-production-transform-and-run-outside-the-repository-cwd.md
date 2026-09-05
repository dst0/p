# 2026-08-17 — Release verifiers must share the production transform and run outside the repository cwd

- **Status:** Resolved
- **Task/context:** Hardening CI verification of the exact release-tag contents and the PR-only version gate.
- **Unexpected observation or failure:** An intermediate verifier could not load because it imported `mkdtempSync` from `node:os`, used `process.cwd()` instead of the supplied repository, treated a Git ref as an expected commit path, and compared pre-release changelog bytes with released bytes. The PR gate also missed versions hidden in internal lockfile entries.
- **Evidence:** Receipt, recovery, certificate, and authorization suites initially aborted at module load. After that was exposed, foreign-cwd receipt fixtures and an internal-lock-entry regression reproduced the remaining fail-open paths. The lockfile regression exited zero before its fix.
- **Approaches tried:**
  - **Attempt:** Independently reimplement version mutation inside the CI verifier and validate a broad release allowlist.
    - **Outcome:** Did not work
    - **Why:** Duplicate transforms drift, broad path checks cannot constrain allowed-file content, and ambient cwd accidentally verifies the caller rather than the supplied repository.
  - **Attempt:** Share pure manifest and lockfile transforms, reconstruct outputs in a detached base worktree, and compare the exact path/blob set while validating the dynamic receipt separately.
    - **Outcome:** Worked
    - **Why:** Both mutation and verification now derive deterministic package, dependency, lockfile, shrinkwrap, fragment-deletion, and changelog outputs from the same certified base.
- **Root cause:** The first verifier combined too many trust-boundary responsibilities without a module-load smoke, foreign-cwd execution, or one canonical content transform.
- **Resolution:** Add `release-version-content.js`, verify lightweight tag and direct parent, recompute audit evidence at `baseSha`, bind one UTC release date, compare exact release outputs, require current origin-main ancestry, and inspect internal workspace versions and dependency ranges in PR lockfiles.
- **Verification:** `npm run check` passes; the release regressions pass in three bounded groups with clean exit codes: 32/32, 9/9, and 9/9. The full combined run also reported 50/50 passing before the compression wrapper reached its own capture limit.
- **Prevention/follow-up:** Every verifier must be tested with `repoRoot !== process.cwd()`, every executable module must have a startup path in the focused suite, and deterministic mutations must use a shared pure transform rather than copied logic.
- **Reusable learning:** At a release trust boundary, exact content reconstruction and foreign-cwd tests are mandatory; path allowlists and duplicated transformations are insufficient.
- **References:** `scripts/release-certificate-receipt.js`, `scripts/release-output-verifier.js`, `scripts/release-version-content.js`, `scripts/release-pr-version-policy.test.js`
