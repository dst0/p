# 2026-08-21 — Cache-boundary tests must canonicalize macOS temporary roots

- **Status:** Resolved
- **Task/context:** Adding direct corruption and lifecycle tests for the project-instruction compilation cache on macOS.
- **Unexpected observation or failure:** Both direct cache tests failed the workspace-containment guard even though their cache directories were visibly nested beneath the temporary workspace.
- **Evidence:** The fixtures supplied a `/var/folders/...` workspace root while `realpathSync()` resolved the cache authority through `/private/var/folders/...`; the focused suite passed after the fixture supplied the canonical workspace root used by production.
- **Approaches tried:**
  - **Attempt:** Pass the raw `mkdtempSync(tmpdir())` result directly to the low-level cache API.
    - **Outcome:** Did not work
    - **Why:** macOS exposes `/var` as a symlink, so string containment against a canonical cache path correctly rejected the noncanonical authority root.
  - **Attempt:** Canonicalize the temporary workspace with `realpathSync()` before constructing cache options.
    - **Outcome:** Worked
    - **Why:** Both sides of the security boundary then used the same filesystem identity without weakening containment checks.
- **Root cause:** The test bypassed the production processor, which canonicalizes the discovered workspace before calling cache primitives, and therefore omitted a required low-level API precondition.
- **Resolution:** Direct cache tests now pass a canonical workspace root while retaining the raw temporary path only for cleanup.
- **Verification:** `project-instructions-compilation-cache.test.ts` passes both successful-record and failure-backoff corruption lifecycles; the changed-line coverage gate passes at 99.01%.
- **Prevention/follow-up:** Canonicalize both authority roots and candidate paths in direct filesystem-boundary fixtures; never relax containment logic to accommodate a path alias.
- **Reusable learning:** On macOS, `/var` and `/private/var` can identify the same object but fail lexical containment; security tests must model the production canonicalization boundary.
- **References:** `packages/coding-agent/test/project-instructions-compilation-cache.test.ts`, `packages/coding-agent/src/core/project-instructions/cache-safety.ts`.
