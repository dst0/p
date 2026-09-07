# 2026-09-06 — Preflight all packages before publishing any

- **Status:** Resolved
- **Task/context:** Adversarially review the new release-package guards before accepting the publication fix.
- **Unexpected observation or failure:** Package-content validation ran only in dry-run mode. Actual publication bypassed it; validating each package immediately before its own upload would still publish earlier packages before discovering a defective final CLI package.
- **Evidence:** Controlled non-dry publisher regressions simulated valid earlier packages and a final CLI without its required shrinkwrap. Before the fix, both npm result formats reached all simulated publish calls instead of rejecting the payload. No real registry writes were involved.
- **Approaches tried:**
  - **Attempt:** Cover only the dry-run path with package-closure regressions.
    - **Outcome:** Did not work
    - **Why:** The actual side-effect branch had a different validation path.
  - **Attempt:** Preflight all pending package contents, then run the dependency-ordered publication phase.
    - **Outcome:** Worked
    - **Why:** Invalid final-package contents stop execution before the first publication; already-published versions remain safely skipped.
- **Root cause:** A safety check existed in a rehearsal branch but was not a prerequisite of the actual side effect.
- **Resolution:** Resolve publication states and validate every pending package before entering the publication loop. Preserve the idempotent skip behavior for versions already present.
- **Verification:** Regression-first simulation covers dry-run, valid publication, missing final shrinkwrap with zero publications, and already-published reruns for both JSON shapes.
- **Prevention/follow-up:** Keep the assertion that the last pack validation precedes the first simulated publication; do not weaken it to one-package-at-a-time validation.
- **Reusable learning:** When several writes form one release, perform all deterministic preflight checks before any of those writes.
- **References:** `scripts/publish.js`; `scripts/publish-package-closure.test.js`.
