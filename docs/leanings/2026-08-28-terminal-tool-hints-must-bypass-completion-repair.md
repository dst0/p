# 2026-08-28 — Terminal tool hints must bypass completion repair

- **Status:** Resolved
- **Task/context:** Integrating the exhausted requirement-recovery stop with the shared agent loop.
- **Unexpected observation or failure:** Returning `terminate: true` from a tool result did not stop an `explicit_finish` run. The loop still entered missing-`finish_work` protocol repair before it honored the termination hint.
- **Evidence:** A focused regression with one terminal tool call and no second scripted provider response timed out after the loop requested call 2. The same test completed with one provider call after the agent-loop guard was added.
- **Approaches tried:**
  - **Attempt:** Set `terminate: true` only in the coding-agent audit tool.
    - **Outcome:** Did not work
    - **Why:** Completion-protocol repair ran before the generic termination hint was checked.
  - **Attempt:** Short-circuit `runLoop` after tool execution when the batch terminates, while preserving the existing `finish_work_called` path.
    - **Outcome:** Worked
    - **Why:** Terminal diagnostics now end the current turn before compaction or another provider request.
- **Root cause:** Agent-loop termination was evaluated after explicit-finish repair logic, so a terminal non-`finish_work` tool result was treated as an incomplete completion protocol.
- **Resolution:** `runLoop` returns after emitting one `agent_end` for terminating batches that do not contain a successful `finish_work` result.
- **Verification:** `packages/agent/test/agent-loop.test.ts` passes 46/46, including the new explicit-finish terminal-tool regression; the coding-agent recovery suite passes 7/7.
- **Prevention/follow-up:** Keep terminal tool outcomes distinct from provider cancellation and correctness failures; add explicit-finish coverage whenever agent-loop termination semantics change.
- **Reusable learning:** A termination hint must be checked before any protocol-repair branch that can issue another provider request.
- **References:** `packages/agent/src/agent-loop/error-recovery.ts`; `packages/agent/test/agent-loop.test.ts`; `docs/leanings/2026-08-28-exhausted-recovery-must-terminate-tool-batch.md`.
