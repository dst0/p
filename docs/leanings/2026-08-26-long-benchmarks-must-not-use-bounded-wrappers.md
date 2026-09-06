# 2026-08-26 — Long benchmarks must not use bounded shell wrappers

- **Status:** Resolved
- **Task/context:** Running the randomized paired project-instruction benchmark for candidate `5.0.1-rc.42`.
- **Unexpected observation or failure:** The first task-3 attempt stopped during its first cell before the benchmark harness produced an authoritative gate result.
- **Evidence:** The benchmark was launched through a bounded shell wrapper, which terminated the parent after its 120-second/output bound. The result directory remained marked `RUNNING`. Re-launching the same candidate directly from a temporary script allowed the cell to reach its configured 2,400-second timeout and produce a `HARD STOP` report with completed cleanup.
- **Approaches tried:**
  - **Attempt:** Launch the long benchmark through the normal compressed shell wrapper.
    - **Outcome:** Did not work
    - **Why:** The wrapper lifetime was shorter than the benchmark cell timeout, so infrastructure killed the evidence process.
  - **Attempt:** Launch the benchmark directly with output redirected to a closed external log, then monitor the log separately.
    - **Outcome:** Worked
    - **Why:** The benchmark harness owned its full timeout and emitted its authoritative report and cleanup state.
- **Root cause:** A bounded command runner was used for a workload whose intended lifetime exceeded the runner bound.
- **Resolution:** Run long benchmark commands directly from an explicit temporary script, redirect output to an active external log, poll progress separately, and Brotli-compress the log at quality 6 only after the process closes.
- **Verification:** `benchmarks/results/2026-08-26-v5.0.1-rc.42-task3-paired-v2/report.md` records the completed hard gate and cleanup; the earlier `v1` result remains preserved as interrupted infrastructure evidence.
- **Prevention/follow-up:** Benchmark runbooks and launch helpers must distinguish bounded diagnostic commands from long-lived evidence processes. Never infer candidate correctness from an infrastructure-interrupted `RUNNING` report.
- **Reusable learning:** A monitoring wrapper must never have a shorter lifetime or output bound than the evidence process it supervises.
- **References:** `benchmarks/results/2026-08-26-v5.0.1-rc.42-task3-paired-v1/`, `benchmarks/results/2026-08-26-v5.0.1-rc.42-task3-paired-v2/`
