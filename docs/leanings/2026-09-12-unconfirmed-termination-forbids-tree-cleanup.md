# 2026-09-12 — Unconfirmed termination forbids tree cleanup

- **Status:** Resolved
- **Task/context:** Cleaning benchmark workspaces after interrupted candidate processes.
- **Unexpected observation or failure:** Cleanup traversed a mutable workspace even when process-tree termination was unconfirmed.
- **Evidence:** A regression could replace the workspace with an external symlink before cleanup, exposing an outside tree to recursive mutation.
- **Approaches tried:**
  - **Attempt:** Continue ordinary sanitization after every process error.
    - **Outcome:** Did not work
    - **Why:** A surviving process retains authority to race pathname resolution.
  - **Attempt:** Quarantine the mutable tree and clean only independently immutable resources.
    - **Outcome:** Worked
    - **Why:** No path below attacker-controlled state is traversed after the lifecycle becomes uncertain.
- **Root cause:** Cleanup assumed failed execution implied stopped execution.
- **Resolution:** Unconfirmed task, preflight, or startup termination marks mutable artifacts unsafe and skips agent-directory, receipt, and Kilo runtime-evidence traversal while still finalizing immutable resources.
- **Verification:** `benchmark-run-finalization.test.ts` and `certification-startup-containment.test.ts` use directory-to-symlink swaps and prove external targets remain unchanged.
- **Prevention/follow-up:** Preserve the quarantined private root for operator diagnosis rather than attempting pathname-based repair.
- **Reusable learning:** Once process ownership is uncertain, do not recursively inspect, redact, or delete its mutable filesystem tree.
- **References:** `benchmarks/test/workloads/benchmark-run-finalization.test.ts`
