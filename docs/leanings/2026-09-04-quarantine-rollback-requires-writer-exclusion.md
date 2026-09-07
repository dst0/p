# 2026-09-04 — Quarantine rollback requires fresh writer exclusion

- **Status:** Resolved
- **Task/context:** Adversarial review of a temporary operational helper for reversible same-device Qdrant directory quarantine.
- **Unexpected observation or failure:** The initial helper reversed completed renames after any verification error, including an error indicating that a new writer appeared. It also trusted source/destination checks performed only before the first move. The initial five tests did not cover these unsafe transitions.
- **Evidence:** Dedicated regressions reproduced a writer appearing during final verification, an empty destination appearing after the first move, and a source directory replaced after preflight. All three failed before the corrections. The successful live quarantine had not entered the rollback path, so these findings do not establish a live data-loss event.
- **Approaches tried:**
  - **Attempt:** Treat exception rollback as inherently safer than leaving a partial transaction.
    - **Outcome:** Rejected.
    - **Why:** Rollback itself mutates storage and can conflict with newly active writers or overwrite a path created after preflight.
  - **Attempt:** Require an explicit rollback-safety callback, freeze as rollback-required when it fails, and revalidate directory type/device/inode/parent identities plus destination absence immediately before every rename.
    - **Outcome:** Worked.
    - **Why:** The new regressions preserve newly appeared storage and forbid reverse moves while writer exclusion is unproven.
- **Root cause:** Writer exclusion and path identity are time-dependent preconditions for both forward and compensating operations; a successful initial preflight does not grant durable mutation authority.
- **Resolution:** Hardened only the temporary recovery helper and driver, added the failing regressions before fixing the behavior, and removed an unsupported crash-durability claim from the test title. Journal writes now synchronize file contents, but directory/power-loss recovery is not certified.
- **Verification:** Eight temporary transaction tests pass, covering preserved bytes, ordinary rollback, forward/final failures, preflight symlinks/collisions, writer appearance, and post-preflight path replacement. No live rollback was attempted while Qdrant was running.
- **Prevention/follow-up:** Require writer exclusion on every rollback step and keep power-loss recovery separate from callback ordering or exception recovery evidence. Rehearse crash recovery before promoting an ad-hoc helper into a supported tool.
- **Reusable learning:** A failed safety check should freeze unsafe mutation, not automatically trigger a different unsafe mutation under the name of rollback.
- **References:** `packages/coding-agent/docs/code-indexing.md`, `docs/leanings/2026-09-04-retired-manifest-blocks-qdrant-gc.md`.
