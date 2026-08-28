# 2026-08-28 — Qdrant file cleanup should filter by stable identity

- **Status:** Resolved
- **Task/context:** Replace changed-file vectors without retaining obsolete chunks or creating an expensive high-cardinality payload index.
- **Unexpected observation or failure:** Filtering deletes by `fileHash` either requires indexing a high-cardinality value or fails under strict remote-Qdrant filtering rules.
- **Evidence:** Paginated cleanup tests preserve the current hash, remove only obsolete explicit point IDs, reject malformed pages, and isolate repositories and files.
- **Approaches tried:**
  - **Attempt:** Add a keyword payload index for every `fileHash`.
    - **Outcome:** Did not work.
    - **Why:** The hash is nearly unique per file version and adds avoidable index storage and recovery work.
  - **Attempt:** Filter obsolete points server-side on an unindexed hash.
    - **Outcome:** Did not work.
    - **Why:** Strict deployments can reject update filters on unindexed fields.
- **Root cause:** The deletion predicate mixed stable identity (`repoId`, `fileId`) with a high-cardinality version discriminator (`fileHash`).
- **Resolution:** Scroll by indexed repository and file identity, compare hashes client-side, then delete obsolete points by explicit ID; deleted files use only the indexed stable identity filter.
- **Verification:** `qdrant-file-version-cleanup.test.ts`, vector-store tests, and refresh lifecycle tests cover pagination and failure-before-manifest-commit behavior.
- **Prevention/follow-up:** Keep server-side filter indexes limited to low-cardinality or stable lookup fields unless measurements justify another index.
- **Reusable learning:** Filter remotely by stable indexed identity; evaluate high-cardinality version predicates client-side when the candidate set is already narrow.
- **References:** `packages/code-index/src/rag/qdrant-file-version-cleanup.ts`, `packages/code-index/src/rag/qdrant-payload-indexes.ts`
