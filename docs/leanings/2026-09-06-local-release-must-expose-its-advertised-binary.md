# 2026-09-06 — Local release must expose its advertised binary

- **Status:** Resolved
- **Task/context:** Run outside-repository smoke checks on the actual Node, Bun-package, and standalone release artifacts.
- **Unexpected observation or failure:** The local release helper printed `bun/p --help`, but the copied standalone directory contained only the upstream `pi` executable. Node and Bun-package entrypoints existed; the advertised standalone path did not.
- **Evidence:** The initial real standalone fixture lacked `bun/p`. A controlled end-to-end local-release regression completed packaging successfully and then failed its assertion that the exact advertised executable existed.
- **Approaches tried:**
  - **Attempt:** Test the existing `pi` executable separately.
    - **Outcome:** Partial
    - **Why:** It could start, but that did not satisfy the helper's documented `p` entrypoint contract.
  - **Attempt:** Materialize the canonical local entrypoint after copying the binary distribution.
    - **Outcome:** Worked
    - **Why:** The local `p`/`p.exe` path now contains the compiled executable; existing canonical entrypoints and upstream archive names remain unchanged.
- **Root cause:** The builder retained the upstream archive/executable naming while the local-release helper advertised the fork's command name without creating it.
- **Resolution:** Create the missing local canonical executable from the existing platform binary during staging, without renaming the shared CI archive layout.
- **Verification:** `scripts/local-release-binary-entrypoint.test.js` builds a controlled distribution through the real local-release script, checks the advertised path, compares its bytes with the upstream binary, and executes it from outside the repository.
- **Prevention/follow-up:** Verify the exact path printed by release tooling rather than silently substituting a differently named executable during smoke tests. Real provider-response validation is a separate gate.
- **Reusable learning:** A successful build is insufficient when the delivered command path does not match the advertised interface.
- **References:** `scripts/local-release.js`; `scripts/local-release-binary-entrypoint.test.js`.
