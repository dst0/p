# 2026-09-23 — Recovery retry patterns must match real provider wording

- **Status:** Resolved
- **Task/context:** p sessions against the local llm-orchestrator (mini-pc Qwen 27B) failed while the orchestrator was loading or switching a model.
- **Unexpected observation or failure:** `API error (503): 503 No workers ready for group: <model>` got only the generic 3-retry budget and the turn failed, although the orchestrator was recovering on its own.
- **Evidence:** `MODEL_RECOVERY_RETRY_PATTERN` on main matched `no available workers` and `workers ... not ready`, but not `No workers ready`. The llm-orchestrator source (3eaf9f2) emits `No workers ready for group: {group}` (server handlers), `no available workers for model: {model}` (core routing error) and `model {model} not ready after 300s` (worker model switcher).
- **Approaches tried:**
  - **Attempt:** Rely on the generic `503` retry.
    - **Outcome:** Did not work
    - **Why:** The generic budget ends before a model load or switch finishes.
  - **Attempt:** Widen the recovery pattern to `no (available|ready) workers` and `no workers ... (available|ready)`.
    - **Outcome:** Worked
    - **Why:** It covers every worker-availability wording the orchestrator emits, and still rejects auth, context-length and rate-limit failures.
- **Root cause:** The pattern was written from assumed phrasings, not from the provider's actual error strings.
- **Resolution:** Widened `MODEL_RECOVERY_RETRY_PATTERN` in `packages/coding-agent/src/core/agent-session/constants.ts`.
- **Verification:** `test/orchestrator-worker-recovery-retry.test.ts` fails on the old pattern (2 of 3 tests) and passes with the fix. The behavior test proves the extended budget and linear delays through `AgentSession`.
- **Prevention/follow-up:** When adding provider-specific retry classes, copy the exact error strings from the provider source or captured responses into the regression test.
- **Reusable learning:** Error classifiers need real provider wording as test fixtures, plus negative cases that must not be reclassified.
- **References:** `packages/coding-agent/test/orchestrator-worker-recovery-retry.test.ts`; llm-orchestrator `crates/llm-orchestrator-server/src/handlers.rs`, `crates/llm-orchestrator-core/src/routing_error.rs`.
