# 2026-09-05 — Ordered Qdrant migration exposes a startup bottleneck

- **Status:** Resolved
- **Task/context:** Compare the existing external ExFAT store with an internal APFS copy before activating a new storage location.
- **Unexpected observation or failure:** The retained database still exceeded p's five-minute default startup budget on the external disk. Successful database recovery alone had not restored normal startup liveness.
- **Evidence:** The fresh external run became ready in 343.855 seconds; the first internal run in 9.855 seconds, approximately 34.9 times faster. Both loaded 23 green collections and reported 452,599 points. A later internal diagnostic started in 8.584 seconds; it does not replace the original timing sample. The offline copy preserved 17,284 files, 3,555 directories and 17,268,645,658 logical bytes; copy plus verification took approximately 358 seconds.
- **Approaches tried:**
  - **Attempt:** Increase startup patience without moving storage.
    - **Outcome:** Useful for measurement, not adopted as the fix.
    - **Why:** It permits diagnosis but leaves normal startup outside its default budget.
  - **Attempt:** Copy the quiescent complete root to internal APFS, verify all bytes/namespace, test before switching and preserve the external original.
    - **Outcome:** Worked.
    - **Why:** Internal startup completed well within the existing budget and the installed runtime's real temporary index/semantic-search smoke passed.
- **Root cause:** The measured storage environment was a major practical startup bottleneck. This sequential experiment does not isolate filesystem format from physical media, OS caches or WAL/recovery effects: external startup can modify persisted state, and copying warms caches. It does not establish the cause of the earlier isolated generation corruption.
- **Resolution:** Changed only the user-level qdrantDataDirectory after verifying effective settings for 20 accessible workspace/daemon contexts. Preserved the external source, quarantine, backup archives and exact prior settings. No package version, source runtime or default timeout changed.
- **Verification:** Same Qdrant binary hash and settings except storage_path; monotonic readiness timing; all collections healthy; fixed sparse queries equivalent after separately adjudicating a cutoff tie; clean process exits; installed hybrid indexing/retrieval smoke exit 0.
- **Prevention/follow-up:** Keep normal startup budget checks separate from recovery probes. Record ordered-run/cache limitations, actual device identity and complete-copy evidence. A directory is not itself a diskutil volume argument; match its device to the inspected mount.
- **Reusable learning:** Measure real persisted startup on the intended storage medium before treating a timeout increase as a repair.
- **References:** `packages/coding-agent/docs/code-indexing.md`; `docs/leanings/2026-09-04-small-qdrant-collections-have-storage-floor.md`; private Brotli Q6 migration receipts retained on the operator host.
