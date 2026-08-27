# 2026-08-27 — Internal controls must be filtered at every public view

- **Status:** Resolved
- **Task/context:** Adversarially review provider-length continuation after its control message was hidden from normal AgentSession events, state, UI, and compaction request extraction.
- **Unexpected observation or failure:** Fork-message enumeration read persisted session entries directly, so the internal `provider_length_continuation` user message remained selectable in interactive clone flows and visible through RPC `get_fork_messages`.
- **Evidence:** A branching/RPC regression appended two external user requests around one internal continuation. Both public surfaces returned three messages before the fix instead of the two external requests.
- **Approaches tried:**
  - **Attempt:** Rely on the already-filtered `session.messages` getter.
    - **Outcome:** Did not work
    - **Why:** Fork selection intentionally needs persisted entry IDs and therefore enumerates `SessionManager` entries directly.
  - **Attempt:** Apply the centralized `isInternalAgentMessage` classification at fork-message enumeration.
    - **Outcome:** Worked
    - **Why:** It preserves persisted history and stable external entry IDs while filtering the public projection used by branching, clone, and RPC.
- **Root cause:** Internal-message classification existed, but one direct persisted-history projection bypassed it.
- **Resolution:** `getUserMessagesForForking()` now excludes centralized internal agent messages before extracting selectable text.
- **Verification:** A focused suite proves the direct branching list and RPC `get_fork_messages` contain both external requests in order and omit the internal continuation.
- **Prevention/follow-up:** Audit every new public history projection that reads `SessionManager` directly; persistence and public visibility are separate contracts.
- **Reusable learning:** Centralized classification only protects the system when every public projection applies it, including alternative views such as export, branching, clone, and RPC.
- **References:** `packages/coding-agent/src/core/agent-session/agentsession-methods/session-forking.ts`, `packages/coding-agent/test/suite/agent-session-provider-length-forking.test.ts`
