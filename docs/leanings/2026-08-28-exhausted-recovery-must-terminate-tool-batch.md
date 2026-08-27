# 2026-08-28 — Exhausted requirement recovery must terminate the tool batch

- **Status:** Resolved
- **Task/context:** Live project-instruction benchmark of the task-verification requirement-definition recovery path.
- **Unexpected observation or failure:** The controller correctly exhausted repeated non-improving complete definitions, but the model could continue issuing audit calls after receiving `next_required_action: none`. A live task therefore kept streaming rejected tool calls without producing a sample.
- **Evidence:** The rc.49 task-3 run reached four complete definitions and three repairs over about 1,000 seconds, with zero samples. The final audit guard prevented validation but did not set the runtime termination hint.
- **Approaches tried:**
  - **Attempt:** Bound cross-cycle fresh definitions globally.
    - **Outcome:** Partial
    - **Why:** It stopped accepting new definitions but left the active model loop running after exhaustion.
  - **Attempt:** Return `terminate: true` with the exhausted audit guard result.
    - **Outcome:** Worked
    - **Why:** The agent loop can finish the current tool batch without interrupting the provider stream or accepting another transition.
- **Root cause:** Recovery exhaustion was represented only in controller guidance; the agent-loop termination protocol was not informed.
- **Resolution:** The exhausted `record_requirement_audit` guard now returns the existing diagnostic with `terminate: true`.
- **Verification:** Added a regression assertion in `task-requirement-definition-cross-cycle-stagnation.test.ts`; the focused suite passes 7/7. The earlier live run remains an infrastructure interruption, not a correctness verdict.
- **Prevention/follow-up:** Keep terminal controller states coupled to the agent-loop `terminate` hint, and preserve the explicit distinction between a terminal recovery stop and a correctness failure.
- **Reusable learning:** A bounded state machine is not live-safe unless its terminal states also stop the outer tool loop.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/requirement-audit-tool.ts`; `packages/coding-agent/test/task-requirement-definition-cross-cycle-stagnation.test.ts`.
