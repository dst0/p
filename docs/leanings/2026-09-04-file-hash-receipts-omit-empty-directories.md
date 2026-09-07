# 2026-09-04 — File-hash receipts do not describe empty directories

- **Status:** Resolved
- **Task/context:** Remove only the private temporary restoration tree after verified Qdrant quarantine cleanup.
- **Unexpected observation or failure:** The scratch-cleanup guard derived allowed directories solely from parents of file-hash entries. It rejected 110 empty directories from the verified restoration as unexpected, leaving the temporary copy and duplicate archive intact.
- **Evidence:** All 110 entries were empty `vector_index-sparse` or `.atomicwrite*` directories beneath known restored Qdrant parents. The earlier full original/restored inventory comparison included directories and passed; the persisted hash receipt recorded only regular files.
- **Approaches tried:**
  - **Attempt:** Infer the entire restored namespace from file-hash paths.
    - **Outcome:** Did not work.
    - **Why:** Empty directories are not ancestors of any regular file and disappear from that derived inventory.
  - **Attempt:** Inspect the exact owned scratch tree, verify the 110 directories are empty and under known Qdrant parents, then bind that explicit list to scratch cleanup while retaining strict file and symlink checks.
    - **Outcome:** Worked for establishing the missing cleanup authority.
    - **Why:** The corrected guard distinguishes verified empty scratch directories from unexpected files and changes no live storage or backup content.
- **Root cause:** A file-content integrity receipt was incorrectly reused as a complete filesystem namespace manifest.
- **Resolution:** Preserved the complete directory-list evidence and completed removal of the exact private restoration tree and byte-identical intermediate archive. Both recovery archives remain mandatory and untouched by that operation.
- **Verification:** A read-only inventory proved the exact count, empty contents, expected parent identities, and Qdrant directory categories. No active index or user-owned repository directory is a cleanup target.
- **Prevention/follow-up:** Persist directory entries alongside file hashes when later lifecycle steps depend on the complete namespace; do not infer full restoration shape solely from nonempty file paths.
- **Reusable learning:** Content integrity and namespace completeness are different backup properties, especially when empty directories have operational meaning.
- **References:** `docs/leanings/2026-09-04-bsdtar-appledouble-restore-needs-literal-entry-mode.md`, `packages/coding-agent/docs/code-indexing.md`.
