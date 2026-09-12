# 2026-09-09 — Session JSONL commit boundaries

- **Status:** Resolved
- **Task/context:** Make session persistence survive interrupted writes and process or machine crashes.
- **Unexpected observation or failure:** Session writes replaced files in place without `fsync`, appends were not flushed durably, and the loader accepted an unterminated final record or silently skipped malformed data.
- **Evidence:** Focused tests reproduced a retained torn tail, missing recovery backup, and acceptance of a complete JSON object after removing exactly its final newline delimiter.
- **Approaches tried:**
  - **Attempt:** Parse any valid JSON remaining at end-of-file.
    - **Outcome:** Did not work
    - **Why:** Without the terminal newline there is no committed-record boundary, even if the bytes happen to form valid JSON.
  - **Attempt:** Write a same-directory temporary file, flush it, publish atomically, and flush the directory; flush append descriptors and repair only the committed prefix.
    - **Outcome:** Worked
    - **Why:** Readers see either the previous file or a fully flushed replacement, while incomplete append tails are unambiguously rejected.
- **Root cause:** JSON syntax was treated as the commit marker and replacement durability stopped at `close`, which is insufficient for crash consistency.
- **Resolution:** Session rewrites and forks use same-directory atomic publication with file and directory `fsync`; appends are flushed; torn tails are removed; non-empty unparseable inputs are backed up before replacement.
- **Verification:** `session-durability.test.ts` covers truncation, exact delimiter loss, repair-before-append, backup, atomic failure preservation, fork residue, file-sync/publication/directory-sync ordering, durable append, and injected fsync, rename, and link failures.
- **Prevention/follow-up:** Keep newline as the durable JSONL record commit marker and preserve original bytes before repairing non-tail corruption.
- **Reusable learning:** For append-only JSONL, valid JSON is not enough: only newline-terminated records belong to the committed prefix.
- **References:** `packages/coding-agent/src/core/session-manager/session-file-durability.ts`, `packages/coding-agent/test/session-manager/session-durability.test.ts`
