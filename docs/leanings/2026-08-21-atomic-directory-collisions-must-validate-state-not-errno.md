# 2026-08-21 — Atomic directory collisions must validate state, not errno

- **Status:** Resolved
- **Task/context:** Adversarial review of concurrent content-addressed project-instruction cache installation.
- **Unexpected observation or failure:** After removing a non-atomic existence preflight, the collision handler accepted `EEXIST` and `ENOTEMPTY`, but Windows can report `EPERM` when renaming a temporary directory onto an existing deterministic version.
- **Evidence:** A focused regression injected a Windows-style `EPERM` after a valid winner already existed; the old handler threw `Destination exists`, while the state-validating handler reused the winner and returned the same immutable version.
- **Approaches tried:**
  - **Attempt:** Enumerate the expected POSIX collision error codes.
    - **Outcome:** Did not work
    - **Why:** Rename error codes for an existing destination directory vary by platform.
  - **Attempt:** On any rename error, accept only a destination that passes the complete immutable-version validation and otherwise rethrow the original error.
    - **Outcome:** Worked
    - **Why:** The decision now depends on authoritative state, so it is portable and cannot hide a failed install without a valid deterministic winner.
- **Root cause:** The collision protocol treated an operating-system errno as the invariant instead of treating the integrity-checked destination as the invariant.
- **Resolution:** `installVersion()` now validates the deterministic winner after every rename failure and rethrows unless that winner is complete and authoritative.
- **Verification:** The Windows-style collision regression fails before the fix and passes after it; cache recovery and real cross-process same-result concurrency suites also pass.
- **Prevention/follow-up:** For cross-platform atomic filesystem protocols, test representative foreign error codes and bind recovery to validated postconditions.
- **Reusable learning:** An errno explains why an operation failed on one platform; a validated postcondition proves whether a concurrent operation already achieved the intended result.
- **References:** `packages/coding-agent/test/project-instructions-cache-rename.test.ts`, `packages/coding-agent/src/core/project-instructions/cache.ts`.
