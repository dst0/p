# 2026-08-28 — Changed-line coverage must bound large diff capture

- **Status:** Resolved
- **Task/context:** Running the repository changed-line coverage gate for the project-instructions benchmark branch.
- **Unexpected observation or failure:** CI ran all agent coverage tests successfully, then the coverage checker failed with `spawnSync git ENOBUFS` before evaluating changed lines.
- **Evidence:** The same command reproduced locally against the CI base SHA. The package-scoped zero-context diff was 2,266,014 bytes, larger than Node's default 1 MiB `execFileSync` buffer.
- **Approaches tried:**
  - **Attempt:** Rerun the coverage command unchanged.
    - **Outcome:** Did not work.
    - **Why:** The child-process output limit remained below the repository diff size.
  - **Attempt:** Add an explicit bounded 32 MiB buffer and a regression test for the configured limit.
    - **Outcome:** Worked.
    - **Why:** The checker can capture the current package diff while retaining a finite memory bound.
- **Root cause:** `execFileSync("git", ...)` inherited Node's 1 MiB default `maxBuffer`; the coverage parser was correct, but the diff transport failed first.
- **Resolution:** Centralized changed-diff execution in `readChangedDiff` with an explicit 32 MiB `maxBuffer`.
- **Verification:** The reproduced coverage command progressed past diff capture; the focused script regression passed. Full check and the required test/install gates remain part of the follow-up verification.
- **Prevention/follow-up:** Keep the buffer explicit and bounded, and retain the regression that asserts the configured limit exceeds the observed large-diff class.
- **Reusable learning:** A coverage parser cannot be validated when the VCS diff producer silently retains Node's small default output cap; large monorepo diffs need an explicit bounded transport budget.
- **References:** `scripts/check-changed-coverage.js`, `scripts/check-changed-coverage.test.js`, CI run `33118627085`.
