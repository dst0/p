# 2026-08-28 — Qdrant mutations require completed results

- **Status:** Resolved
- **Task/context:** Make payload-index creation, point upserts, and deletions safe for immediate dependent operations.
- **Unexpected observation or failure:** An accepted Qdrant update is not sufficient evidence that a following filtered operation can use the mutation.
- **Evidence:** Mutation-completion tests return acknowledged, malformed, and completed result envelopes for payload indexes, upserts, filtered deletes, and explicit-ID deletes.
- **Approaches tried:**
  - **Attempt:** Treat an HTTP success response as completion.
    - **Outcome:** Did not work.
    - **Why:** Qdrant can acknowledge an update before applying it.
  - **Attempt:** Add `wait=true` without validating the result.
    - **Outcome:** Partial.
    - **Why:** The client still needs to fail closed if the response does not report `completed`.
- **Root cause:** Transport success, operation acknowledgement, and durable mutation completion are separate states.
- **Resolution:** Every dependent mutation sends `wait=true` and validates a `completed` result through one shared response guard.
- **Verification:** `qdrant-mutation-completion.test.ts` and vector-store transport tests cover all mutation paths.
- **Prevention/follow-up:** Reuse the completion guard for every future Qdrant mutation that has an immediate dependent read or write.
- **Reusable learning:** Never infer database mutation completion from HTTP success or acknowledgement alone.
- **References:** `packages/code-index/src/rag/qdrant-update-result.ts`, `packages/code-index/src/rag/qdrant-rest-client.ts`
