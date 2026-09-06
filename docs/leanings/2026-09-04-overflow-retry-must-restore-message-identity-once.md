# 2026-09-04 — Overflow retry must restore message identity once

- **Status:** Resolved
- **Task/context:** Adversarial lifecycle verification of pending continuation retention through compaction.
- **Unexpected observation or failure:** The first retry after provider context overflow contained the same queued user steering twice. In another completion mode, the old copy was truncated while a full duplicate was appended.
- **Evidence:** The faux-provider regression `agent-session-provider-overflow-continuation.test.ts` observed `[continuation, steering, compactionSummary, steering]` in the implicit-mode retry. The session persisted only one steering entry. The explicit-finish variant exercised replacement of a compacted copy.
- **Approaches tried:**
  - **Attempt:** Append the latest user message whenever the rebuilt context does not end with a user role.
    - **Outcome:** Did not work
    - **Why:** The session builder intentionally places a compaction summary after retained raw history, so the last role does not indicate whether steering is already present.
  - **Attempt:** Avoid appending when equal text or a matching timestamp exists.
    - **Outcome:** Rejected before adoption
    - **Why:** Repeated user text is legitimate, timestamps can collide, and truncation changes the text that requires restoration.
- **Root cause:** Recovery inferred missing state from a trailing message role instead of the identity of the authoritative branch entry being retried.
- **Resolution:** Select the latest user message entry from the current branch, locate its retained object before truncation, then replace that exact slot with the original message. Append only when the selected entry was discarded. Perform restoration before token accounting and compaction events.
- **Verification:** Four focused suites passed, 45 tests total, covering implicit and explicit-finish overflow retry, streamed text/tool continuation, auto-compaction queues, and existing compaction behavior. The new regression checks exact ordering, one persisted steering/control entry, and duplicate-free semantic output.
- **Prevention/follow-up:** Keep both completion modes in the lifecycle regression. Recognized current overflow errors are hidden from persisted history; do not misattribute this duplication to an error message necessarily surviving reload.
- **Reusable learning:** Rebuilding context is an identity-preserving state transition; role or text similarity cannot safely decide whether an execution input needs replay.
- **References:** `packages/coding-agent/src/core/agent-session/agentsession-methods/auto-compaction.ts`, `packages/coding-agent/test/suite/agent-session-provider-overflow-continuation.test.ts`, `packages/coding-agent/docs/compaction.md`.
