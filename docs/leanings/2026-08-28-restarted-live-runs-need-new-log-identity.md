# 2026-08-28 — Restarted live runs need new log identity

- **Status:** Resolved
- **Task/context:** A short installed-`p` AI canary was monitored once per minute before an expensive paired benchmark.
- **Unexpected observation or failure:** Monitoring showed no progress after the specification read even though the restarted run created, validated, and completed the requested artifact within its gate.
- **Evidence:** The terminal restart created a second session JSONL. The monitor kept reading the earlier session path, whose timestamp and size stayed unchanged. The newer JSONL contained requirement preparation, three convergent definition repairs, artifact creation, validation, and final completion in 6 minutes 50 seconds.
- **Approaches tried:**
  - **Attempt:** Treat the unchanged initially discovered JSONL as proof that the provider turn was stalled.
    - **Outcome:** Did not work
    - **Why:** Session logs are process-identity scoped; restarting `p` created a new file while the stale file remained valid and unchanged.
  - **Attempt:** Re-enumerate recent session files and bind the newest file to the restarted run's start time and live terminal process.
    - **Outcome:** Worked
    - **Why:** The correct log immediately exposed the complete progress timeline and precise completion duration.
- **Root cause:** The monitor bound a file path before the final successful process launch and did not refresh that identity after restarting the terminal command.
- **Resolution:** Live-run monitoring must rediscover the session JSONL after every restart and bind it to the current process/session start before interpreting silence or progress.
- **Verification:** The replacement JSONL recorded the successful canary from initial plan through final response, and the independently validated artifact matched its specification and ended in LF.
- **Prevention/follow-up:** The repository agent instructions now require session-log rediscovery and identity binding after a live `p` restart. Benchmark monitoring should prefer the harness-owned progress log and rebind any auxiliary session log after child replacement.
- **Reusable learning:** A log path is evidence only for the process identity that created it; restart means rediscover and rebind before diagnosing liveness.
- **References:** `AGENTS.md` and the installed-`p` canary session `01a043bd-eb18-7dc8-b8c9-fbd7a2574ffd`.
