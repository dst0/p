# 2026-09-09 — Exclusive publish tracks durability uncertainty

- **Status:** Resolved
- **Task/context:** Create a new session file atomically without overwriting another writer.
- **Unexpected observation or failure:** An exclusive hard-link publish could succeed, remove its temporary file, and then fail directory `fsync`. The caller kept `flushed=false`, so every retry met `EEXIST` even though the intended target already existed.
- **Evidence:** An injected second `fsync` failure left the exact target bytes present; the old retry could not converge.
- **Approaches tried:**
  - **Attempt:** Treat every thrown publication error as if no target existed.
    - **Outcome:** Did not work
    - **Why:** Failures before link and failures after link have different externally visible states.
  - **Attempt:** Mark post-publication durability uncertainty explicitly and accept an existing target only when its bytes exactly match the intended content.
    - **Outcome:** Worked
    - **Why:** Idempotent retry can flush the directory while a different writer's target still fails closed without overwrite.
- **Root cause:** Publication and durable directory commit were represented by one undifferentiated failure state.
- **Resolution:** The writer reports `published_not_durable`, the session manager records the in-process publication, and exclusive retry compares exact bytes before treating `EEXIST` as idempotent.
- **Verification:** `session-durability.test.ts` injects the first and second durability boundaries, retries identical bytes successfully, and proves differing bytes are never overwritten.
- **Prevention/follow-up:** Model atomic file publication as pre-publication, published-not-durable, and durable states.
- **Reusable learning:** Post-publication `fsync` failure is uncertainty, not non-publication; retries must be idempotent and content-bound.
- **References:** `packages/coding-agent/src/core/session-manager/session-file-durability.ts`, `packages/coding-agent/src/core/session-manager/sessionmanager-methods/persistence.ts`
