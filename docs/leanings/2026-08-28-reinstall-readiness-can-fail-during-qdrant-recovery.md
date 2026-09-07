# 2026-08-28 — Reinstall readiness can fail during Qdrant recovery

- **Status:** Open
- **Task/context:** Reinstall the current checkout after requirement-repair changes and verify the installed CLI and indexing service.
- **Unexpected observation or failure:** Build, relink, compaction-settings verification, and a real semantic-search smoke passed, but the final readiness check timed out while the indexing daemon repeatedly restarted Qdrant during collection recovery.
- **Evidence:** The reinstall log records `Real semantic-search smoke passed (1 result)` followed by a timeout from `scripts/indexing-service-health.js`. The daemon status remained `running:false`; service logs recorded Qdrant startup timeouts, failed collection writes, and an embedding-server `address already in use` error. No requirement or benchmark process was active.
- **Approaches tried:**
  - **Attempt:** Rerun reinstall through the bounded shell wrapper.
    - **Outcome:** Did not work.
    - **Why:** The wrapper timed out at 120 seconds and left a readiness child behind.
  - **Attempt:** Rerun reinstall in a dedicated tmux session and observe the full lifecycle.
    - **Outcome:** Partial.
    - **Why:** Build and relink completed, but the independent six-minute readiness gate still failed during Qdrant recovery.
- **Root cause:** The indexing service could not become ready within its configured startup window while restoring the existing Qdrant collection set; whether the collection volume, stale daemon state, or embedding-port collision is the primary cause remains to be isolated.
- **Resolution:** No source change was made. The failed readiness result is retained as an environment/service blocker rather than being reported as a green reinstall.
- **Verification:** `npm run check` passed; the reinstall build, CLI relink, compaction checks, and semantic-search smoke passed. The final daemon readiness check failed honestly and its closed log was retained in Brotli Q6 form.
- **Prevention/follow-up:** Run long reinstalls in a native detached session, inspect exact daemon/Qdrant/embedding identities and listeners, and do not change search configuration or kill unrelated processes without explicit scope. Resolve the startup-timeout/port-collision path before using reinstall as a release gate.
- **Reusable learning:** A successful build and smoke query do not prove service readiness; keep the final daemon-health gate separate and visible.
- **References:** `reinstall.sh`, `scripts/indexing-service-health.js`, `packages/coding-agent/test/indexing-version.test.ts`
