# 2026-09-09 — Plan execution context needs one authoritative lifecycle

- **Status:** Resolved
- **Task/context:** Deliver the full plan roadmap and progress contract when plan mode transitions to execution.
- **Unexpected observation or failure:** `before_agent_start` appended execution context after plan mode was disabled, but the later context transform removed that message and did not recreate it, so the model received neither remaining steps nor `[DONE:n]` guidance.
- **Evidence:** An extension-runner regression exercised `/plan`, plan extraction, the execute choice, and the next provider turn; no execution context reached that request before the fix.
- **Approaches tried:**
  - **Attempt:** Inject in one lifecycle callback and filter stale copies in another callback.
    - **Outcome:** Did not work
    - **Why:** Actual event ordering made the filter authoritative and erased the newly injected message.
  - **Attempt:** Make the context transform both remove stale copies and inject exactly one current execution message.
    - **Outcome:** Worked
    - **Why:** One lifecycle now owns deduplication and delivery using the same live plan state.
- **Root cause:** Two lifecycle handlers shared ownership of one ephemeral prompt with incompatible state conditions.
- **Resolution:** Plan execution context is created only by the context transform, which first removes stale plan messages and then appends one current roadmap.
- **Verification:** `plan-mode-extension-lifecycle.test.ts` uses the real extension runner and faux provider to assert exactly one roadmap containing all remaining steps and `[DONE:n]` guidance.
- **Prevention/follow-up:** Assign one authoritative lifecycle to each ephemeral prompt and test the full event order, not only formatting helpers.
- **Reusable learning:** Ephemeral context injection and deduplication must happen in the same lifecycle owner.
- **References:** `packages/coding-agent/examples/extensions/plan-mode/index.ts`, `packages/coding-agent/test/suite/plan-mode-extension-lifecycle.test.ts`
