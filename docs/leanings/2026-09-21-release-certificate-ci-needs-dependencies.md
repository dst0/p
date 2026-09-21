# 2026-09-21 — Release certificate CI needs locked dependencies

- **Status:** Resolved
- **Task/context:** Validate and publish the certified `v5.0.1` release from the tag workflow.
- **Unexpected observation or failure:** The tag workflow stopped in `Verify release certificate` before any build or publish job ran.
- **Evidence:** GitHub Actions run `35557448751`, job `106203735325`, failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'semver' imported from scripts/release-target-policy.js`. The workflow checked the certificate before running `npm ci --ignore-scripts`.
- **Approaches tried:**
  - **Attempt:** Rerun the unchanged tag workflow.
    - **Outcome:** Did not work
    - **Why:** The checked-out release commit still ran certificate verification before installing dependencies, so the same deterministic missing-module failure remained.
  - **Attempt:** Move certificate verification after the locked dependency install and add an ordering regression test.
    - **Outcome:** Worked
    - **Why:** The verifier can load the exact semver version from the lockfile without executing dependency lifecycle scripts, while the tag and certificate remain unchanged.
- **Root cause:** The workflow assumed `actions/setup-node` populated `node_modules`; it only configured Node and npm caching. The certificate verifier imports a declared dependency that is absent until `npm ci` runs.
- **Resolution:** Install system dependencies and run `npm ci --ignore-scripts` before invoking `scripts/verify-release-certificate.js`.
- **Verification:** `scripts/release-workflow.test.js` asserts the order and the locked install command; the existing tag certificate remains bound to the exact release commit and tag.
- **Prevention/follow-up:** Keep dependency bootstrap ordering covered by the workflow test; dispatch the existing `v5.0.1` tag only after the workflow fix is merged.
- **Reusable learning:** Setup actions do not install JavaScript dependencies; any CI step importing a package must follow the locked, script-disabled install step.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`, GitHub Actions run `35557448751`
