# 2026-08-27 — Terminal abort must stop post-run continuation

- **Status:** Resolved
- **Task/context:** Diagnose deterministic `AgentSession` concurrent steering and follow-up test timeouts after inter-turn cancellation began emitting a terminal aborted assistant message.
- **Unexpected observation or failure:** Calling `abort()` with one queued steering or follow-up message caused the active prompt to exceed the 30-second test timeout, while aborting the same stream without a queued message settled normally.
- **Evidence:** A focused run reproduced two deterministic 30-second timeouts and one passing prompt-guard sibling. The active stream observed the aborted signal and settled, but post-run handling immediately started a second provider run with a fresh signal because the agent queue was still non-empty.
- **Approaches tried:**
  - **Attempt:** Treat the failures as full-suite load or timer flakiness.
    - **Outcome:** Did not work
    - **Why:** The focused three-test run reproduced only the two queued-message failures in 60.28 seconds of test time.
  - **Attempt:** Stop post-run continuation when the settled assistant has `stopReason: "aborted"`.
    - **Outcome:** Worked
    - **Why:** The terminal message is the authoritative abort boundary, so queued-message presence cannot authorize a new provider run under a new signal.
- **Root cause:** `_handlePostAgentRun()` unconditionally returned `agent.hasQueuedMessages()` after every terminal run. Once cancellation emitted an explicit aborted assistant, that fallback converted a settled abort into a fresh continuation whose signal was not aborted.
- **Resolution:** Return immediately from post-run handling for terminal aborted assistant messages. Leave normal successful, retry, compaction, and queued-message paths unchanged.
- **Verification:** `packages/coding-agent/test/agent-session-concurrent.test.ts` proves abort settles with queued steering and follow-up messages; `packages/coding-agent/test/suite/agent-session-queue.test.ts` covers normal non-abort queue delivery.
- **Prevention/follow-up:** Treat terminal lifecycle states as explicit post-run decisions before consulting residual queues. Never infer continuation authorization from queue presence alone after abort.
- **Reusable learning:** A queue can describe pending user intent without authorizing execution after a terminal cancellation; settlement state must be checked first.
- **References:** `packages/coding-agent/src/core/agent-session/agentsession-methods/model-resolution.ts`, `packages/coding-agent/test/agent-session-concurrent.test.ts`
