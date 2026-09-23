# 2026-09-23 — Explicit completion needs a repair bound

- **Status:** Resolved
- **Task/context:** An independent review of the adaptive verification tiers, together with an earlier interactive smoke test of STRICT against a faux model that only answers in text.
- **Unexpected observation or failure:** Under `explicit_finish`, a model that keeps answering in text is repaired forever. The smoke session logged about 73 missing-`finish_work` repairs in five seconds before it was interrupted by hand.
- **Evidence:** `resolveCompletionLimits` defaulted `maxNoProgressTurns` and `maxMissingFinishRetries` to `+Infinity` for `explicit_finish`, and the missing-finish counter only acted in `hybrid`. The new regression uses a text-only scripted model with a 50-call safety cap. On the previous loop code it never stops, and the test times out.
- **Approaches tried:**
  - **Attempt:** Rely on `maxTurns`.
    - **Outcome:** Rejected.
    - **Why:** `maxTurns` is intentionally unlimited so that long, productive tasks are never cut off.
  - **Attempt:** Bound only consecutive unproductive behavior. Explicit completion stops after three consecutive text-only answers (`maxMissingFinishRetries`) or six turns without progress (`maxNoProgressTurns`, the documented default of 5). Successful tool work resets both counts.
    - **Outcome:** Worked.
    - **Why:** A productive run is never limited. A stuck run ends quickly with a user-facing reason, keeps the model's last answer, and can continue when the user replies.
- **Root cause:** The explicit protocol treated "the model must call `finish_work`" as a reason to retry without bound, instead of as a reason to stop.
- **Resolution:** `protocolLimitDiagnostic` in `packages/agent/src/agent-loop/protocol-limits.ts` decides whether to stop. `DEFAULT_MAX_EXPLICIT_MISSING_FINISH_RETRIES = 3`. Repair events now report the bound that is actually used.
- **Verification:** `packages/agent/test/explicit-completion-repair-limits.test.ts` has four cases: a text-only stop after three repairs with the exact reason, a reset after progress, a stop after unproductive tool turns, and explicit overrides. All four fail on the previous code and pass now. All 484 existing agent tests pass.
- **Prevention/follow-up:** Every retry protocol needs a consecutive-failure bound that resets on real progress.
- **Reusable learning:** A protocol repair is a retry, and every retry needs a bound. Stop with a clear reason rather than loop, and let the user decide how to continue.
- **References:** `packages/agent/src/agent-loop/message-preparation.ts`, `packages/agent/src/agent-loop/protocol-limits.ts`, `packages/agent/test/explicit-completion-repair-limits.test.ts`
