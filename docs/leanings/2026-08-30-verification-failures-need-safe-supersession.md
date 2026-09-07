# 2026-08-30 — Verification failures need safe supersession

- **Status:** Resolved
- **Task/context:** A live requirement-repair canary reached final verification after producing the requested artifact and focused evidence.
- **Unexpected observation or failure:** One malformed pytest `-k` selector remained a permanent completion blocker after the same focused test passed through its direct pytest node ID.
- **Evidence:** The malformed name-filter command produced a pytest usage error. The later direct `file.py::test_name` invocation collected one test and passed, but `ready_to_finish` still required the impossible malformed command to pass unchanged.
- **Approaches tried:**
  - **Attempt:** Rerun the intended focused test through its direct node ID.
    - **Outcome:** Partial
    - **Why:** The test passed, but selector coverage treated the two command forms as unrelated.
  - **Attempt:** Retire every earlier failure after any later passing test.
    - **Outcome:** Did not work
    - **Why:** That would allow unrelated tests to hide genuine failures.
- **Root cause:** Failure retirement understood exact commands and ordinary file/glob coverage, but not the safe equivalence between a pytest name filter on one file and the same normalized direct node ID on that file.
- **Resolution:** A later positive pytest node-ID result now supersedes the earlier failed name-filter attempt only when the earlier output is the pytest `-k` usage diagnostic; the ecosystem, working directory, file path, and normalized test name all match exactly; and both invocations contain no extra collection targets or options beyond a small presentation-only allowlist.
- **Verification:** Focused regressions reproduce the live malformed-filter then passing-node-ID sequence and prove that genuine assertion failures, boolean or repeated filters, nested nodes, different files or directories, alternate runners, and additional file, directory, or glob targets remain blocked.
- **Prevention/follow-up:** Keep failure retirement monotonic by requiring structured scope equivalence and a positive passing result; never retire failures merely because a later command exited successfully.
- **Reusable learning:** Verification ledgers need safe semantic supersession, not permanent exact-command debt and not unrestricted last-success-wins behavior.
- **References:** `packages/coding-agent/test/task-verification-pytest-launch-failure-recovery.test.ts`
