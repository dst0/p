# 2026-09-12 — Certified runtime defaults must be explicit

- **Status:** Resolved
- **Task/context:** Reviewing same-model option parity and P completion semantics in certified mode.
- **Unexpected observation or failure:** P runtime defaulted to evidence verification, but the harness stored `undefined` and therefore did not require the matching terminal completion; a separate compiler-model override was also accepted.
- **Evidence:** CLI help documents evidence as the P default, while `createAgentTaskCompletionGuard` receives the parsed optional value and treats an absent value as no explicit verification protocol.
- **Approaches tried:**
  - **Attempt:** Rely on downstream runtime defaults.
    - **Outcome:** Did not work
    - **Why:** The harness and child resolved the same missing value differently.
  - **Attempt:** Bind evidence explicitly and reject asymmetric compiler/verification overrides.
    - **Outcome:** Worked
    - **Why:** Command construction, completion guard, evidence capture, and runtime now share one certified value.
- **Root cause:** An implicit child default crossed a process boundary without being normalized in the parent harness.
- **Resolution:** Certified parsing sets `taskVerificationMode` to `evidence` and rejects `off`, `audit`, and a separate compiler model.
- **Verification:** `certification-option-parity.test.ts` covers the default and each rejected override.
- **Prevention/follow-up:** Normalize every behavior-affecting default before binding a certified execution plan.
- **Reusable learning:** A certified harness must record effective defaults explicitly; `undefined` is not proof of parity.
- **References:** `benchmarks/src/workloads/runner-options.ts`, `benchmarks/src/workloads/agent-turn-runner.ts`.
