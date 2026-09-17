# 2026-09-09 — Session append failures require state barriers

- **Status:** Resolved
- **Task/context:** Keep the in-memory session graph consistent with its durable JSONL representation when an append fails.
- **Unexpected observation or failure:** `_appendEntry()` advanced the in-memory entry list, index, and leaf before persistence. A serialization failure left that unpublished entry as the next parent, so a later successful append wrote a dangling child. The first fix serialized only when immediately writing, so an invalid entry before the first assistant remained deferred in memory and poisoned the later full flush.
- **Evidence:** Regressions appended BigInt custom entries both after a flushed assistant and before the deferred first flush. The former manufactured an absent parent; the latter returned success initially and made the later assistant persist fail.
- **Approaches tried:**
  - **Attempt:** Mutate memory first and propagate every persistence exception unchanged.
    - **Outcome:** Did not work
    - **Why:** Definite pre-write failure and possible partial publication require different recovery actions.
  - **Attempt:** Serialize before opening, roll back definite non-publication, classify failures after write begins as uncertain, and poison the live session until reopen.
    - **Outcome:** Worked
    - **Why:** Safe failures remain retryable without manufacturing parents, while ambiguous disk state cannot accumulate more descendants.
- **Root cause:** The append path had no transaction boundary or publication-state classification between memory and disk.
- **Resolution:** Every entry in a persisted session is serialized before any in-memory mutation, including deferred pre-assistant entries. Definitely unpublished entries roll back; append write, flush, or close failures poison the live session until recovery.
- **Verification:** `session-append-consistency.test.ts` proves immediate rejection before and after first flush, a correct next parent on disk, fail-stop behavior after injected write uncertainty, and successful append after reopen.
- **Prevention/follow-up:** Every persistence exception must state whether publication is impossible, possible, or confirmed before in-memory state can advance.
- **Reusable learning:** Transactional append code must couple durable publication state with its in-memory parent/index state.
- **References:** `packages/coding-agent/src/core/session-manager/session-file-durability.ts`, `packages/coding-agent/src/core/session-manager/sessionmanager-methods/persistence.ts`, `packages/coding-agent/test/session-manager/session-append-consistency.test.ts`
