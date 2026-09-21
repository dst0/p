# 2026-09-21 — Indexing daemon reuse must bind runtime provenance

- **Status:** Resolved
- **Task/context:** Repairing a local `p` installation after moving active work from an older worktree to the canonical development worktree.
- **Unexpected observation or failure:** The global CLI could be relinked to one worktree while the indexing daemon kept executing code from another worktree.
- **Evidence:** Process inspection showed the managed CLI link and the running indexing daemon resolved to different repository roots. The existing reuse decision compared code and configuration hashes but did not identify the executable runtime root.
- **Approaches tried:**
  - **Attempt:** Rely on the indexing version and runtime configuration fingerprint.
    - **Outcome:** Did not work
    - **Why:** Two worktrees at the same commit can have identical hashes while still being different runtime installations with independently changing build artifacts.
  - **Attempt:** Persist and compare canonical daemon and runtime-root paths in both service status and one-shot reuse decisions.
    - **Outcome:** Worked
    - **Why:** Reuse now requires the live daemon to originate from the exact runtime selected by the reinstall transaction.
- **Root cause:** Reinstall reuse identity covered code content and configuration but omitted runtime provenance, so an otherwise healthy daemon from an obsolete worktree was accepted.
- **Resolution:** Record canonical runtime provenance when the daemon writes status, propagate it through the one-shot reuse marker, and fail closed when provenance is absent or different.
- **Verification:** Focused unit tests cover cross-runtime rejection, legacy status rejection, marker invalidation, and symlink canonicalization; reinstall and live-process verification confirm the daemon starts from the current canonical runtime.
- **Prevention/follow-up:** Keep runtime provenance in every future daemon-reuse contract and treat older status or marker formats as requiring a restart.
- **Reusable learning:** Content equality is insufficient for reusing long-lived local services; bind reuse to the canonical executable runtime as well as code and configuration hashes.
- **References:** `scripts/indexing-service-reuse.js`, `packages/coding-agent/src/core/indexing-service.ts`, `packages/coding-agent/src/core/indexing-daemon/indexingdaemon-methods/status-logging.ts`
