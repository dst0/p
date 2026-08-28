# 2026-08-28 — Qdrant GC must reprove ownership and snapshot refreshes

- **Status:** Resolved
- **Task/context:** Reclaim obsolete local Qdrant generations without deleting live or externally owned collections.
- **Unexpected observation or failure:** A runtime-only active flag cannot protect startup GC, standalone refreshes, or a refresh that begins or commits during collection inventory.
- **Evidence:** Adversarial tests reproduce refreshes on both sides of inventory, malformed or ambiguous locks, ownership changes between daily passes, shutdown during a pending ownership proof, and shutdown between two deletion candidates.
- **Approaches tried:**
  - **Attempt:** Protect only collections referenced by one manifest snapshot.
    - **Outcome:** Did not work.
    - **Why:** A concurrent refresh can create or commit a generation between snapshot and deletion.
  - **Attempt:** Apply namespace-based cleanup to remote Qdrant.
    - **Outcome:** Did not work.
    - **Why:** A local installation cannot prove ownership of similarly named remote collections.
- **Root cause:** Collection reachability and endpoint ownership are time-dependent cross-process facts, not static naming properties.
- **Resolution:** Run GC at startup and 24 hours after each completed pass; before every pass reprove managed-local ownership, take two fail-closed protection snapshots, union manifests and checkpoints, honor refresh locks, and recheck deletion authority before deleting each exact managed name older than 24 hours.
- **Verification:** `qdrant-collection-garbage-collector.test.ts`, lock-state regressions, and daemon backend lifecycle tests cover the safety boundaries.
- **Prevention/follow-up:** Keep remote/external endpoints maintenance-only until collections carry an installation ownership identity.
- **Reusable learning:** Destructive background maintenance needs fresh ownership proof plus before-and-after reachability snapshots around external inventory.
- **References:** `packages/coding-agent/src/core/indexing-daemon/qdrant-collection-garbage-collector.ts`, `packages/code-index/src/rag/manifest.ts`
