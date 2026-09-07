# 2026-09-04 — Compaction must preserve unanswered controller instructions

- **Status:** Resolved
- **Task/context:** Full-suite verification after replacing caller-authored completion evidence mappings.
- **Unexpected observation or failure:** A streamed noncoding response was persisted correctly, but the next provider request lost the instruction to continue after its completed prefix. The generic head-and-tail truncator retained only the first and last lines of the controller's three-line continuation message.
- **Evidence:** `agent-session-stream-generation-continuity.test.ts` failed its exact continuation assertion under compaction pressure. Four new pending-control unit cases failed before the fix, while the ordinary/history truncation negative case already passed.
- **Approaches tried:**
  - **Attempt:** Treat the failure as another obsolete verification-tool argument after a schema migration.
    - **Outcome:** Rejected after inspection
    - **Why:** This scenario did not call the changed verification tool; the missing text belonged to a provider-length continuation.
  - **Attempt:** Exempt all internal messages from truncation indefinitely.
    - **Outcome:** Rejected before adoption
    - **Why:** Completed historical control messages must remain compactable; retaining them forever would accumulate stale instructions.
- **Root cause:** The history truncator treated pending controller instructions as ordinary user text solely because their transport role is `user`.
- **Resolution:** Existing trusted internal-message metadata identifies continuation and repair controls in the unanswered suffix after the most recent non-error assistant message. Their content is preserved verbatim; answered controls, unknown metadata, and ordinary user text remain subject to truncation. A provider overflow error does not answer a pending control, but explicit cancellation stays terminal. The final provider capacity check is unchanged.
- **Verification:** Five focused compaction suites passed, 28 tests total, including streamed tool and text continuation, queued steering, historical-control truncation, error-versus-cancellation boundaries, and content-block metadata preservation. The overflow boundary case failed before excluding error responses.
- **Prevention/follow-up:** Keep the end-to-end faux-provider assertion alongside the focused compaction regressions. Public schema removals also need a provider-boundary test: direct controller calls may bypass schema validation and accept obsolete fields.
- **Reusable learning:** Execution-control messages and historical prose can share a transport role but cannot share a lossy retention policy while the control is pending.
- **References:** `packages/coding-agent/test/compaction-pending-control-message-retention.test.ts`, `packages/coding-agent/test/suite/agent-session-stream-generation-continuity.test.ts`, `packages/coding-agent/docs/compaction.md`.
