# 2026-09-06 — New npm packages need publication readiness

- **Status:** Open
- **Task/context:** Restore code-index to the lockstep publisher without discovering an account prerequisite only after pushing a release tag.
- **Unexpected observation or failure:** The public registry lookup for `@dst0/p-code-index` returned E404 while the other four package names resolved. No trusted-publisher binding for this package was verified.
- **Evidence:** Read-only npm metadata lookups and the GitHub OIDC workflow configuration. A public E404 does not distinguish a nonexistent package from one unavailable to that lookup; no npm account credentials were inspected or changed.
- **Approaches tried:**
  - **Attempt:** Verify package manifests, publication order, and repository metadata locally.
    - **Outcome:** Partial
    - **Why:** These establish the code path, not npm account ownership, first-publication readiness, or trusted-publisher authorization.
- **Root cause:** Code readiness and external package-account readiness are separate states. The exact package availability and publisher setup remain unverified.
- **Resolution:** Code scope and repository metadata are corrected; external readiness is still open. No bootstrap package, local publication, npm account change, or release tag was created during this investigation.
- **Verification:** Local negative/positive publication simulations validate behavior but cannot establish npm account permissions.
- **Prevention/follow-up:** Before the first tag release, verify package availability/access and the exact `dst0/p` repository plus `build-binaries.yml` trusted-publisher binding. If first publication requires a separate bootstrap, obtain explicit direction for that operation rather than inventing a version or bypassing the certified release transaction.
- **Reusable learning:** Adding a package to CI does not grant CI authority to publish it.
- **References:** `.github/workflows/build-binaries.yml`; `scripts/publish.js`; [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
