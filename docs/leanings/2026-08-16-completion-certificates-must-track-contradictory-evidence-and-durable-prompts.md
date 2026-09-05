# 2026-08-16 — Completion certificates must track contradictory evidence and durable prompts

- **Status:** Resolved
- **Task/context:** Adding a sequential, evidence-backed user-requirement audit to the coding-agent completion protocol.
- **Unexpected observation or failure:** A successful focused test executed during the audit reset readiness and made the next verdict impossible, while a failed focused test executed after certificate issuance left the old token usable. Restoring before requirement definition also left `status` pointing at a decomposition prompt that might already have been compacted away.
- **Evidence:** Focused regressions reproduced all three failures: `ready_to_finish -> define -> focused test -> verdict`, `completion_ready -> failed focused test -> finish_work`, and `ready_to_finish -> controller restore -> status`.
- **Approaches tried:**
  - **Attempt:** Reuse final-verification auto-recording unchanged while layering the requirement audit above it.
    - **Outcome:** Did not work
    - **Why:** Auto-recording treated new evidence as a fresh final-state transition even when final verification was already current, and failed evidence was appended without invalidating the previously issued readiness state.
  - **Attempt:** Keep the full decomposition instructions only in the original `ready_to_finish` result.
    - **Outcome:** Did not work
    - **Why:** Persisted state survived restoration, but the model-visible tool result was not a durable recovery source after compaction.
- **Root cause:** The original final-verification lifecycle assumed readiness was terminal and evidence only accumulated before readiness. The new multi-turn audit permits evidence both during and after readiness, so every contradictory observation and every recovery instruction must participate in the persisted state machine.
- **Resolution:** Preserve active audit readiness when additional successful evidence arrives, clear the certificate and verdicts on later failed verification, re-check unresolved failed commands and verdict evidence at the completion gate, and render the exact persisted source prompts from both `ready_to_finish` and `status`.
- **Verification:** The focused requirement-audit suite covers evidence collection during audit, post-certificate failure, certificate and verdict corruption, persistence recovery, exact prompt entry IDs, and non-code mutations; `npm run check` passes.
- **Prevention/follow-up:** For any future completion state, add adversarial transitions for new positive evidence, new negative evidence, restart/compaction, and partial or failed terminal calls before considering the state terminal.
- **Reusable learning:** A completion certificate is valid only while every later observation remains consistent with it, and every recovery prompt must be reproducible from persisted state rather than an earlier transient tool result.
- **References:** `packages/coding-agent/test/task-requirement-audit-lifecycle.test.ts`, `packages/coding-agent/test/task-requirement-audit-regressions.test.ts`, `packages/coding-agent/test/task-requirement-audit-state-machine.test.ts`
