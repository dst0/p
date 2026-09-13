# 2026-09-12 — Certified startup needs the same sandbox

- **Status:** Resolved
- **Task/context:** Auditing production containment before the benchmark task matrix begins.
- **Unexpected observation or failure:** Kilo model-resolution and request startup probes executed outside the sandbox even though task and parity turns were contained.
- **Evidence:** A real child-process fixture read a sibling secret twice during startup while every task-turn containment test remained green.
- **Approaches tried:**
  - **Attempt:** Rely on later task sandboxing.
    - **Outcome:** Did not work
    - **Why:** Startup is executable candidate code and can access host state before task cells begin.
  - **Attempt:** Route both startup commands through the same certified command wrapper.
    - **Outcome:** Worked
    - **Why:** Runtime, workspace, configuration, and network permissions now match the certified task boundary.
- **Root cause:** Startup probes bypassed the common task runner where sandbox wrapping was added.
- **Resolution:** Wrapped Kilo model resolution and live request startup commands with `sandboxedCommandIfNeeded`.
- **Verification:** `certification-startup-containment.test.ts` proves both startup invocations receive access denial outside the boundary.
- **Prevention/follow-up:** Enumerate every candidate process phase when asserting containment, including discovery and startup.
- **Reusable learning:** Setup probes are candidate execution and require the same sandbox as measured work.
- **References:** `benchmarks/src/workloads/startup-probes.ts`.
