# 2026-09-21 — Progress states must preserve orthogonal lifecycle signals

- **Status:** Resolved
- **Task/context:** Keeping orchestrator queue, model-switch, loading, sending, and retry progress truthful in the interactive footer.
- **Unexpected observation or failure:** Queue updates erased model-switch/loading state, retry lifecycle events replaced the queue with synthetic prefill, and `request_start` set a recent model switch only to erase it with sending before the single render.
- **Evidence:** Stateful footer regressions reproduced queue loss across retry events and showed that the provider contained sending but no model switch after a recent-switch request start.
- **Approaches tried:**
  - **Attempt:** Treat every progress update as one mutually exclusive phase.
    - **Outcome:** Did not work
    - **Why:** Agent queue state and worker switch/loading state describe different layers and can be true simultaneously.
  - **Attempt:** Preserve orthogonal states explicitly and show sending only when no recent switch or orchestrator queue owns the status.
    - **Outcome:** Worked
    - **Why:** The footer reflects the server lifecycle without manufacturing prefill or hiding worker recovery.
- **Root cause:** Setter-level exclusivity encoded a single flat state machine for multiple independent orchestration layers.
- **Resolution:** Allow queue, switch, and loading progress to coexist; preserve queue/switch through retry starts and synthetic sleep turns; clear switch only on explicit completion; and avoid overwriting a recent switch with sending before render.
- **Verification:** Five focused UI files pass 39 tests, including real provider state transitions and simultaneous footer rendering. With the three source files reverted, 5 of those tests fail (re-checked 2026-09-23).
- **Prevention/follow-up:** Classify new progress fields by lifecycle owner before deciding which setters may clear them, and test state sequences rather than isolated setter calls.
- **Reusable learning:** UI progress is often a product of orthogonal state machines; preserve independent signals until their owning lifecycle explicitly completes them.
- **References:** `packages/coding-agent/src/core/footer-data-provider/footerdataprovider-methods/progress-tracking.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode/interactivemode-methods/message-event-handler.ts`, `packages/coding-agent/test/interactive-mode-queue-progress.test.ts`
