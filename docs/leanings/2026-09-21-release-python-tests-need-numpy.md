# 2026-09-21 — Release Python tests need NumPy installed explicitly

- **Status:** Resolved
- **Task/context:** Publish the certified `v5.0.2` release after the binary build and release certificate checks passed.
- **Unexpected observation or failure:** The `publish-npm` job failed during the `@dst0/p-code-index` Python test command on a clean hosted runner, although all JavaScript tests passed.
- **Evidence:** Workflow run `35568830322` reported five Python test import errors with `ModuleNotFoundError: No module named 'numpy'`; the package test command then exited with code 1 before npm publishing.
- **Approaches tried:**
  - **Attempt:** Rerun the release workflow after adding the optional Ollama gate.
    - **Outcome:** Did not work.
    - **Why:** The gate fixed service-dependent test behavior but did not provide the Python dependency used by code-index tests.
  - **Attempt:** Add an explicit pinned NumPy install to both release test jobs and a static workflow regression.
    - **Outcome:** Worked locally.
    - **Why:** The release jobs now provision the dependency before `npm test`, and the regression prevents the setup from drifting away from the test steps.
- **Root cause:** Release jobs installed Node/system packages but assumed the hosted runner already provided the Python dependency declared by `packages/code-index/requirements.txt`.
- **Resolution:** Both `validate` and `publish-npm` install `numpy==2.5.1` with the runner's Python before running tests.
- **Verification:** `scripts/release-workflow.test.js` passes all 10 test cases after first failing on the missing setup step; the failed workflow log identifies the exact missing module.
- **Prevention/follow-up:** Keep release workflow Python test dependencies explicit and pinned; rerun the immutable `v5.0.2` workflow after this fix is merged.
- **Reusable learning:** A clean hosted release runner is not a development machine; every non-Node test dependency must be provisioned by the release workflow before the package test command.
- **References:** `.github/workflows/build-binaries.yml`, `scripts/release-workflow.test.js`, `packages/code-index/requirements.txt`, run `35568830322`.
