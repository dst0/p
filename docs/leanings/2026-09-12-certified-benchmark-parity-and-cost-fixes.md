# 2026-09-12 — Certified benchmark parity, containment, and streaming cost reconciliation

- **Status:** Resolved
- **Task/context:** Implementing certified benchmark comparison mode for P, Pi, and Kilo across four canonical benchmark tasks.
- **Unexpected observation or failure:** Certified execution failed on multiple fronts: (1) `result-publication.ts` was missing, blocking multi-cell publication; (2) preflight P probe exited code 86 because IPC receipt authority was omitted; (3) P monetary cost from streamed `message_end` events was lost during accumulator extraction; (4) initial sandbox wiring omitted startup probes; (5) the receipt survived in task artifacts and cleanup ignored redaction errors; (6) baseline comparison agents with partial quality scores failed closed prematurely.
- **Evidence:** Focused red tests reproduced missing publication, streamed-cost loss, external-file reads by unsandboxed startup probes, live-checkout probe selection, recoverable receipts in retained artifacts, and a documented default output path rejected by containment.
- **Approaches tried:**
  - **Attempt:** Enforce quality pass identically across all agents including baselines.
    - **Outcome:** Did not work.
    - **Why:** Pi and Kilo baseline runs often solve partial fixture requirements cleanly; failing the entire comparison when a baseline achieves partial rubric score prevents comparative performance analysis.
  - **Attempt:** Wire complete startup/task containment, frozen runtime closures, IPC receipt channels, streamed cost accumulation, fail-closed artifact cleanup, and separate process completion from rubric pass for baselines while strictly requiring 100% score for P.
    - **Outcome:** Worked.
    - **Why:** Ensures strict comparative integrity: P must achieve full rubric score and zero penalties, baseline runs provide valid comparisons on partial completion, and all executed code and retained evidence remain inside the certified boundary.
- **Root cause:** Missing coordination glue and an incomplete threat boundary in benchmark workload runners: unpopulated IPC options, missing streamed cost assignment, unsandboxed setup commands, live code paths, fail-open cleanup, and conflated process and rubric status.
- **Resolution:** Added multi-cell publication, cost preservation, frozen candidate/runtime binding, startup and task sandboxing, fail-closed receipt cleanup, and independent baseline process/quality semantics.
- **Verification:** Focused adversarial tests cover each corrected path; the complete benchmark suite and live certified run remain required before release.
- **Prevention/follow-up:** Maintain regression suites in `certification-adversarial-regressions.test.ts`, `certification-streaming-cost.test.ts`, and `certification-baseline-quality.test.ts`.
- **Reusable learning:** Comparative multi-agent benchmarking requires separating process/protocol viability from quality grading on baselines, while strictly sandboxing execution and redacting ephemeral verification secrets before artifacts are persisted.
- **References:** `benchmarks/src/workloads/certification.ts`, `benchmarks/src/workloads/certification-preflight.ts`, `benchmarks/src/workloads/agent-turn-runner.ts`, `benchmarks/src/harness/p-recording.ts`.
