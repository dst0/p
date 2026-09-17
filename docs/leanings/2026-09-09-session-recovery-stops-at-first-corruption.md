# 2026-09-09 — Session recovery stops at first corruption

- **Status:** Resolved
- **Task/context:** Recover JSONL sessions containing a malformed committed record.
- **Unexpected observation or failure:** The loader skipped an invalid interior line and retained later records, which could preserve a child while discarding its parent and manufacture a dangling session history.
- **Evidence:** A regression placed a malformed parent before a syntactically valid child; the old loader returned the header and child.
- **Approaches tried:**
  - **Attempt:** Skip each malformed line and continue parsing later records.
    - **Outcome:** Did not work
    - **Why:** JSONL order is part of the parent-chain commit history; later syntax validity does not prove semantic independence.
  - **Attempt:** Back up the original bytes and retain only the valid committed prefix before the first malformed record.
    - **Outcome:** Worked
    - **Why:** Recovery cannot invent ancestry that was not successfully parsed.
- **Root cause:** Recovery treated records as independent JSON values instead of an ordered session graph.
- **Resolution:** Parsing reaches a recovery boundary at the first malformed newline-terminated record and ignores every later record; repair rewrites only the preceding prefix after backup.
- **Verification:** `session-durability.test.ts` proves the dangling child is discarded and the repaired file contains only the valid header; `file-operations.test.ts` keeps large-file streaming coverage aligned with the same fail-closed boundary.
- **Prevention/follow-up:** Never resume ordered session recovery after an unknown committed record.
- **Reusable learning:** For ordered append logs with references, syntax recovery must stop at the first corrupt record.
- **References:** `packages/coding-agent/src/core/session-manager/session-io.ts`, `packages/coding-agent/test/session-manager/session-durability.test.ts`, `packages/coding-agent/test/session-manager/file-operations.test.ts`
