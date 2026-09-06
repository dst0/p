# 2026-09-05 — Default compaction retry identity comes from the branch

- **Status:** Resolved
- **Task/context:** Adversarial review of provider-overflow continuation after project-instruction and verification-control compaction changes.
- **Unexpected observation or failure:** The overflow path contained a fallback to the latest user message in global agent state, but successful compaction already requires a non-empty user request in the captured branch. Existing overflow coverage always selected an extension compactor and did not prove the default LLM compactor preserved pending internal control.
- **Evidence:** `prepareCompaction()` rejects a branch without a user request before retry selection, making the global-state fallback unreachable. The prior provider-overflow test installed `session_before_compact`, so it never traversed the default compactor branch.
- **Approaches tried:**
  - **Attempt:** Add a lifecycle test for the global-state fallback.
    - **Outcome:** Did not work
    - **Why:** Reaching it requires bypassing the production branch precondition and would create an artificial coverage-only test.
  - **Attempt:** Remove the dead fallback and exercise overflow with no compaction extension through the faux provider.
    - **Outcome:** Worked
    - **Why:** The test now traverses the real default summarizer and verifies exact continuation, steering, structured state, error removal, and deduplication.
- **Root cause:** Retry identity had two apparent sources even though only the captured branch can satisfy the compaction contract, and the lifecycle suite covered only the extension override.
- **Resolution:** Use the authoritative branch user entry as retry identity and add a default-compactor overflow lifecycle regression.
- **Verification:** Provider-overflow, pending-control, and compaction focused suites pass with 43 tests across the reviewed paths.
- **Prevention/follow-up:** Treat compactor selection as a test dimension when pending internal messages must survive overflow recovery; do not mock an unreachable fallback merely to fill a branch.
- **Reusable learning:** Overflow retry identity and pending-control restoration must be proven on the authoritative branch with both extension and default compactor paths.
- **References:** `packages/coding-agent/src/core/agent-session/agentsession-methods/auto-compaction.ts`, `packages/coding-agent/test/suite/agent-session-provider-overflow-continuation.test.ts`
