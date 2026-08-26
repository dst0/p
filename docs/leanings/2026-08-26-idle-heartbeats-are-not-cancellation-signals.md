# 2026-08-26 — Idle heartbeats are not cancellation signals

- **Status:** Resolved
- **Task/context:** Monitoring the first rc.41 task 3 benchmark attempt with minute-level progress checks.
- **Unexpected observation or failure:** A semantic heartbeat with `phase: idle` prompted a manual interruption near the boundary where the first mutation appeared; the heartbeat alone did not prove a dead provider request.
- **Evidence:** The operator session observed the interrupt after roughly 150 seconds without a semantic event, while the persisted result records the first mutation at 184.174 seconds and infrastructure-invalid termination at 204.956 seconds with zero samples. The result artifact does not preserve signal provenance, so the exact overlap is inferred rather than independently proven.
- **Approaches tried:**
  - **Attempt:** Cancel after an extended idle semantic phase.
    - **Outcome:** Did not work
    - **Why:** The heartbeat reported absence of recent semantic events, not absence of an active provider request.
  - **Attempt:** Let the benchmark-owned timeout and terminal markers decide liveness unless process identity or provider state proves a dead child.
    - **Outcome:** Worked
    - **Why:** The authoritative second attempt reached its configured hard gate and published complete terminal evidence.
- **Root cause:** Monitoring conflated event-stream inactivity with process or provider inactivity.
- **Resolution:** Manual cancellation is no longer based on `phase: idle` alone. Monitoring continues every minute, but termination requires authoritative timeout, process exit, or exact process/provider evidence of a dead run.
- **Verification:** The second run was allowed to reach the harness timeout and produced a valid hard-stop report rather than an infrastructure-invalid sample.
- **Prevention/follow-up:** Keep minute-level reads observational; do not introduce a second watchdog with weaker liveness semantics than the harness.
- **Reusable learning:** An idle semantic heartbeat means no recent recorded event, not no live request; observe frequently but cancel only from authoritative lifecycle evidence.
- **References:** `benchmarks/results/2026-08-26-v5.0.1-rc.41-task3-paired-v1/`, `benchmarks/results/2026-08-26-v5.0.1-rc.41-task3-paired-v2/`
