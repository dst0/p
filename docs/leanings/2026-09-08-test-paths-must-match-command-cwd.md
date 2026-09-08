# 2026-09-08 — Test paths must match the command cwd

- **Status:** Resolved
- **Task/context:** Run a focused coding-agent regression from the package directory.
- **Unexpected observation or failure:** A combined command used repository-root-prefixed test paths while its cwd was already `packages/coding-agent`, so the preliminary file check failed and the unset log path caused secondary shell errors.
- **Evidence:** `wc` reported both test files missing and the later log commands received an empty path; rerunning with package-relative paths succeeded.
- **Approaches tried:**
  - **Attempt:** Reuse root-relative paths after changing the command cwd.
    - **Outcome:** Did not work
    - **Why:** The paths resolved beneath `packages/coding-agent/packages/coding-agent`.
  - **Attempt:** Bind all command arguments to the declared cwd and initialize the log path independently.
    - **Outcome:** Worked
    - **Why:** Test and log paths were valid before execution reached the runner.
- **Root cause:** The command's cwd and argument namespace were assembled independently.
- **Resolution:** Package-scoped commands now use `test/...` paths; repository-scoped checks use `packages/coding-agent/test/...` paths.
- **Verification:** The corrected focused Vitest invocation passed.
- **Prevention/follow-up:** Resolve the cwd first, then construct every relative path against it; do not condition log-variable initialization on an unrelated preflight command.
- **Reusable learning:** Treat cwd plus relative arguments as one identity-bound command specification.
- **References:** `packages/coding-agent/test/runtime-factory.test.ts`
