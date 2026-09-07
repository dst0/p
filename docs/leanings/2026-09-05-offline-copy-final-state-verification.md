# 2026-09-05 — Copy verification must cover the final state

- **Status:** Resolved
- **Task/context:** Adversarial review of temporary offline copy and activation helpers before migrating managed Qdrant storage.
- **Unexpected observation or failure:** The initial helper verified destination shape before hashing but did not recheck it afterward. A previously hashed file could change, or an empty directory could be added/removed, without invalidating its proof. Activation also initially trusted an older prepared-path receipt without rereading the current target.
- **Evidence:** Reconstructing the earlier copy behavior produced three genuine failing mutation regressions; the corrected copy helper passed all nine tests. Five activation tests cover canonical success, moved destination, changed configuration, wrong identity/device and a redirected storage directory.
- **Approaches tried:**
  - **Attempt:** Treat per-file hashes and a preflight directory listing as final-state proof.
    - **Outcome:** Rejected.
    - **Why:** Those checks describe different moments and do not protect the interval after an individual hash completes.
  - **Attempt:** Recheck source and destination identity/namespace after all hashes; revalidate target device, inode, config digest and canonical storage path immediately before activation.
    - **Outcome:** Worked.
    - **Why:** The mutation regressions fail closed while valid copies remain usable.
- **Root cause:** Verification authority is time-dependent; earlier path and byte checks cannot silently authorize a later state transition.
- **Resolution:** Hardened the temporary helpers before activating the live copy. A separate copy attempt stopped when the conservative process guard detected a potential writer while a parallel CLI version check was running; the source was preserved and CLI checks were deferred for the successful retry. The detected PID's full command was not retained, so that temporal association is not a separately proven process attribution.
- **Verification:** Fourteen copy/activation tests passed. The live copy passed complete byte and namespace checks with writers excluded. Only the verified duplicate partial copy was eligible for removal; no original or recovery archive was discarded.
- **Prevention/follow-up:** Do not run even harmless-looking p metadata checks concurrently with a copy guarded against all p writers. Keep partial destinations unactivated and re-prove authority before cleanup or rollback.
- **Reusable learning:** A verified copy and a safe activation require checks at the final transition boundary, not only at the start of the operation.
- **References:** `packages/coding-agent/docs/code-indexing.md`; `docs/leanings/2026-09-04-file-hash-receipts-omit-empty-directories.md`; `docs/leanings/2026-09-04-quarantine-rollback-requires-writer-exclusion.md`.
