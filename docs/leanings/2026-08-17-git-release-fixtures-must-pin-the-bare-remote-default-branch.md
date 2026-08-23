# 2026-08-17 — Git release fixtures must pin the bare remote default branch

- **Status:** Resolved
- **Task/context:** Running the release-certificate pull-request suite on the Linux GitHub Actions runner.
- **Unexpected observation or failure:** Two release-flow tests passed locally but failed in CI when a clone could not push `main`; the bare fixture remote advertised a nonexistent default branch.
- **Evidence:** With `GIT_TEST_DEFAULT_INITIAL_BRANCH_NAME=master`, both the local reproduction and CI emitted `warning: remote HEAD refers to nonexistent ref` followed by `error: src refspec main does not match any`. The same tests passed when the host Git default branch was already `main`.
- **Approaches tried:**
  - **Attempt:** Rely on the non-bare fixture checkout being initialized with `-b main`.
    - **Outcome:** Did not work
    - **Why:** That selected only the working repository branch; the separately initialized bare remote kept the host-dependent default branch in its `HEAD` symbolic ref.
  - **Attempt:** Initialize both the working repository and bare remote with an explicit `main` initial branch.
    - **Outcome:** Worked
    - **Why:** Fresh clones now check out the published `main` branch independently of global Git configuration.
- **Root cause:** The fixture pinned the local repository branch but left the bare remote default branch implicit, so its behavior depended on the machine's `init.defaultBranch` setting.
- **Resolution:** Initialize the bare fixture remote with `git init --bare -b main`.
- **Verification:** Run the focused release-flow and origin-ancestry tests with `GIT_TEST_DEFAULT_INITIAL_BRANCH_NAME=master`, then rerun the ordinary focused release suite and CI.
- **Prevention/follow-up:** Every Git fixture that clones a bare remote must explicitly set that remote's initial branch or symbolic `HEAD`; never depend on host Git defaults.
- **Reusable learning:** Pin branch topology in fixtures at every repository boundary, not only in the primary working clone.
- **References:** `scripts/release-flow-test-fixture.js`, `scripts/release-flow-certificate.test.js`, `scripts/release-origin-ancestry.test.js`
