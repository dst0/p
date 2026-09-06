# 2026-09-01 — Verification control-plane exemptions must cover the whole protocol

- **Status:** Partial
- **Task/context:** Repair the outer project-instruction benchmark validator after an audit-mode calculator workload completed successfully but its result was discarded.
- **Unexpected observation or failure:** Exempting every `record_requirement_audit` call and only `record_task_verification(action: "status")` did not fix the live benchmark. The next candidate again failed with `completed mutating action had no authoritative rule batch` after the inner workload passed 6/6 and produced an accepted audit certificate.
- **Evidence:** The failed live cell recorded four task-verification readiness attempts, twelve requirement-audit calls, an accepted audit certificate, and an accepted finish. Production declares both verification tools read-only, but the compiled rule gate and benchmark mirror treated the five non-status task-verification actions as mutations. A regression containing the complete six-action task-verification protocol failed before the correction and passed afterward.
- **Approaches tried:**
  - **Attempt:** Exempt only requirement-audit calls plus task-verification status recovery.
    - **Outcome:** Did not work
    - **Why:** `ready_to_finish` and the evidence-recording actions are also trusted internal protocol transitions, so a later verification turn could still be required to produce an impossible project-rule receipt.
  - **Attempt:** Exempt every schema-valid action of the identity-protected built-in task-verification tool.
    - **Outcome:** Partial
    - **Why:** Focused production, benchmark, and parity regressions pass; a new live outer benchmark replay is still required.
- **Root cause:** The control-plane abstraction was modeled per action instead of per trusted protocol. That contradicted the read-only tool-effect declaration and left later protocol transitions exposed to mutation routing in both production and benchmark classification.
- **Resolution:** Treat all six schema-valid `record_task_verification` actions as verification control-plane operations. Production still requires the exact protected built-in tool-definition identity, and malformed or unknown actions remain non-exempt. The hermetic benchmark mirror uses the same explicit action set and is bound by expected-value parity tests.
- **Verification:** Provider-free regressions cover all six valid actions, unknown and malformed actions, parser exclusion from mutating evidence, and production-to-benchmark parity. Live rc.60 replay remains pending.
- **Prevention/follow-up:** Model managed tools by their complete effect and protocol contract. When a trusted tool gains an action, update one explicit action-set regression that asserts expected classifications rather than testing mirror parity alone.
- **Reusable learning:** A trusted read-only protocol is only as safe and reliable as its least-consistently classified transition.
- **References:** `docs/leanings/2026-09-01-benchmark-action-classification-must-match-runtime-gate-exemptions.md`, `packages/coding-agent/src/core/agent-session/project-instruction-action-phases.ts`, `benchmarks/src/project-instructions/verification-control-plane.ts`
