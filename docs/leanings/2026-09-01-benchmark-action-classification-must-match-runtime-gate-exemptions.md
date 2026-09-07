# 2026-09-01 — Benchmark action classification must match runtime gate exemptions

- **Status:** Resolved
- **Task/context:** Validate compiled project instructions with the three-condition project-instruction benchmark.
- **Unexpected observation or failure:** A compiled-audit cell completed its workload and semantic audit, but the outer benchmark discarded the result because it reported a completed mutating action without an authoritative rule batch.
- **Evidence:** Runtime inspection showed that `record_requirement_audit` is a trusted project-rule control-plane action and never enters the mutation gate. Benchmark recording classified the same action as potentially mutating. A focused regression reproduced the extra recorded action and the existing validator then required an impossible rule receipt for it.
- **Approaches tried:**
  - **Attempt:** Allow a proactive `read_rules` call to establish authority without a pending runtime batch.
    - **Outcome:** Did not work
    - **Why:** The runtime intentionally stages and commits a rule receipt only for the exact batch selected by the first potentially mutating action. Relaxing the validator would have accepted evidence the runtime does not authorize.
  - **Attempt:** Mirror the runtime control-plane exemption in benchmark action classification.
    - **Outcome:** Worked
    - **Why:** The benchmark no longer sends a runtime-safe requirement-audit action through mutating-action validation while preserving all existing rule-batch checks for real mutations.
- **Root cause:** Benchmark and runtime independently encoded trusted project-rule control-plane semantics, and the benchmark omitted the unconditional `record_requirement_audit` exemption.
- **Resolution:** Centralized the production verification control-plane predicate behind the runtime's tool-definition identity check. The hermetic benchmark snapshot keeps a local mirror because its source closure cannot import production files; an explicit matrix parity test now binds that mirror to production semantics.
- **Verification:** The focused action-evidence regression fails before the fix by recording `record_requirement_audit` as a mutation and passes after the fix while all existing authoritative-batch cases remain green.
- **Prevention/follow-up:** Extend the production predicate and the hermetic benchmark mirror together whenever a managed verification tool changes; the matrix parity test must remain green.
- **Reusable learning:** An external evidence validator must mirror runtime gate exemptions exactly; do not weaken receipt requirements to compensate for a classifier mismatch.
- **References:** `benchmarks/src/project-instructions/routing.ts`, `benchmarks/test/project-instructions/action-evidence.test.ts`, `packages/coding-agent/src/core/agent-session/agentsession-methods/tool-hooks.ts`
