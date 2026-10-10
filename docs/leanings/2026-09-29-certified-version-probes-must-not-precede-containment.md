# 2026-09-29 — Certified version probes must not precede containment

- **Status:** Resolved
- **Task/context:** Independently review the certified P/Pi/Kilo benchmark before merging its egress-proxy PR.
- **Unexpected observation or failure:** Candidate Pi and Kilo binaries ran `--version` while the benchmark still had the caller's environment, home access, and unrestricted network.
- **Evidence:** A regression with marker-writing candidate executables failed before the fix in both `resolveAgentVersions()` and `bindCertifiedHarness()`. The code paths ran before snapshotting, private directories, and sandbox setup.
- **Approaches tried:**
  - **Attempt:** Skip early execution only when a special binding flag is set.
    - **Outcome:** Partial.
    - **Why:** A future binding call could omit the flag and silently restore unsafe execution.
  - **Attempt:** Defer all certified candidate version checks and run them after freezing inside a separate, private sandbox.
    - **Outcome:** Worked.
    - **Why:** Binding now records expected versions and hashes without executing Pi/Kilo; a later isolated probe verifies the real versions.
- **Root cause:** Metadata discovery treated candidate `--version` as inert, despite it being arbitrary executable code with ambient process authority.
- **Resolution:** No certified candidate version command runs before freeze; the Node binding uses the current process version without executing a second binary. Each frozen executable is checked for safe file identity and run with a minimal environment, throwaway writable directory, no network or fork grant, and bounded process-group cleanup. The probe must match the bound expected version and hash.
- **Verification:** The marker regressions changed red to green. A macOS sandbox regression confirms ambient environment and external host/config files are unreadable, benchmark output is unwritable, network connection is denied, and mismatched versions fail. A uniquely marked background-child regression failed before fork denial and passes after it. Focused certification tests pass. The live 36-cell model benchmark remains unverified.
- **Prevention/follow-up:** Keep candidate metadata reads passive until the sandbox exists; audit all future preflight and startup paths for executable side effects.
- **Reusable learning:** `--version` is execution, not metadata access. Freeze first, then probe untrusted binaries with strictly less authority than their actual task run.
- **References:** `benchmarks/src/workloads/certification-version-probes.ts`, `benchmarks/test/workloads/certification-version-probe-containment.test.ts`.
