# 2026-09-05 — Process-tree regressions require process inspection

- **Status:** Resolved
- **Task/context:** Running the project-instructions release verification before publishing the next candidate.
- **Unexpected observation or failure:** The benchmark script suite failed its nested process-group interruption regression under a restricted shell although the relevant implementation and test were unchanged from the previous candidate.
- **Evidence:** Process inspection returned `EPERM` for `ps`. The outer supervisor's short termination grace expired before the nested supervisor could discover and join its child process group. The same six-test suite passed outside that restriction, as did three repeated focused runs, without surviving owned processes.
- **Approaches tried:**
  - **Attempt:** Treat the failed full-suite result as evidence of a new process-cleanup regression.
    - **Outcome:** Did not work
    - **Why:** Exact-file comparison showed no change and a direct process-inspection probe reproduced the environmental denial.
  - **Attempt:** Rerun the unchanged regression with process inspection available.
    - **Outcome:** Worked
    - **Why:** The supervisor could identify the nested process group and complete its existing bounded cleanup protocol.
- **Root cause:** The test depends on OS process-tree inspection that the earlier execution environment denied. Its interruption ordering differs when that prerequisite is unavailable.
- **Resolution:** Use the unrestricted test environment already authorized for this workspace; retain the cleanup assertions and production deadlines unchanged.
- **Verification:** The complete six-test process-interruption suite and three focused repetitions passed with process inspection enabled. The repository-wide suite remains a separate pre-push gate.
- **Prevention/follow-up:** Before diagnosing nested process-cleanup failures, probe the actual process-inspection capability and inspect exact source differences. Do not skip assertions or increase production timeouts to hide an environment denial.
- **Reusable learning:** A sandbox failure can change lifecycle ordering, not just command success. Reproduce the missing OS capability before changing a process supervisor.
- **References:** `benchmarks/test/harness/process-interruption.test.ts`, `benchmarks/src/harness/process-control.ts`, `package.json`
