# 2026-08-21 — Long processes must outlive command-output guards

- **Status:** Resolved
- **Task/context:** Continue the compiled project-instruction benchmark with the event-sourced inventory fixture and run the repository's full unit gate.
- **Unexpected observation or failure:** The first task-3 attempt stopped after 120 seconds without producing `results.json`, even though the benchmark command redirected its visible output to a file. The first full-unit invocation later hit the same wrapper guard after all visible suites were green.
- **Evidence:** The wrapper reported its 120-second/8 MB limit, the benchmark process was gone, and the result directory contained only a partial compressed recording. Detached runners using the same benchmark and unit commands completed normally and produced authoritative zero process exits where applicable.
- **Approaches tried:**
  - **Attempt:** Keep the long-running benchmark inside the command-compression wrapper with shell redirection.
    - **Outcome:** Did not work
    - **Why:** The wrapper lifecycle still governed the child process and terminated it at its own guard.
  - **Attempt:** Launch a detached child with file-backed status and output, then poll only the small status file.
    - **Outcome:** Worked
    - **Why:** The benchmark lifetime no longer depended on the command-output transport, while progress and exit status remained observable.
- **Root cause:** Output redirection reduced displayed noise but did not detach process ownership from the wrapper's runtime and output limits.
- **Resolution:** Preserve the partial attempt as local aborted evidence, rerun through a detached status-file runner, and use only the completed `results.json` for comparison.
- **Verification:** The restarted inventory run exited zero after 1,790.8 seconds and produced a 95/100 failed quality result with a complete Brotli recording and report. The detached full-unit gate also exited zero with all Node, Vitest, release, hook, and Python segments passing.
- **Prevention/follow-up:** Run benchmarks or test gates whose expected duration/output exceeds wrapper limits through a detached, status-file-backed launcher; keep active logs uncompressed and store completed recordings with Brotli Q6.
- **Reusable learning:** Redirecting output does not necessarily detach lifecycle authority; long jobs need an explicit process-lifetime boundary plus a separately polled completion contract.
- **References:** `benchmarks/results/2026-08-21-project-instructions-p-inventory/`.
