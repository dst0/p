# 2026-09-06 — Require Bun for standalone release tests

- **Status:** Resolved
- **Task/context:** Close the release evidence gap for the standalone Bun package-metadata fix before tagged artifacts are uploaded.
- **Unexpected observation or failure:** The domain regression intentionally skips on machines without Bun, so a green general test run could contain no standalone execution. The Bun-enabled binary build job did not invoke that regression before upload.
- **Evidence:** Running the focused suite without Bun exited successfully with all three standalone cases skipped. A workflow-contract regression then failed because `Build binaries` was followed immediately by changelog extraction. After the gate was added, the workflow test proved an explicit `bun --version` check precedes the targeted Vitest command between binary construction and upload.
- **Approaches tried:**
  - **Attempt:** Treat a skip-capable unit-suite result as release evidence in every environment.
    - **Outcome:** Did not work.
    - **Why:** Absence of Bun converts every deployment-format assertion into a skip while the process still exits successfully.
  - **Attempt:** Run the focused compiled-binary regression in the pinned-Bun build job and make `bun --version` an explicit prerequisite.
    - **Outcome:** Worked.
    - **Why:** The release path now fails closed when Bun or the standalone regression is unavailable, before any archive upload.
- **Root cause:** The deployment-specific regression and the release job that owns its runtime were not connected, while the test's portability skip could look like an ordinary green result.
- **Resolution:** Add a mandatory standalone metadata verification step immediately after binary construction, explicitly verify Bun first, and keep the workflow ordering protected by a release-workflow regression.
- **Verification:** The no-Bun probe exited zero with three skips, demonstrating the trap. The workflow regression was RED before the step and GREEN afterward; its focused suite passed 4/4, and the complete release-audit suite passed 67/67.
- **Prevention/follow-up:** Keep skip-capable standalone tests bound to a Bun-required release step. The regression compiles a fresh minimal executable and validates source-to-sidecar behavior; startup and version checks against the actual packaged cross-platform archive remain a separate release smoke gate.
- **Reusable learning:** A green suite containing skipped deployment-specific tests is not evidence for that deployment; bind the test to a job that fails when its runtime is absent.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`, `packages/coding-agent/test/standalone-package-version.test.ts`, `docs/leanings/2026-09-06-standalone-bun-binary-version-resolution.md`
