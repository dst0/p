# 2026-09-26 — Indexing installer modules need version-hash coverage

- **Status:** Resolved
- **Task/context:** Extract the semantic-search installer smoke into a bounded module.
- **Unexpected observation or failure:** A change to the new installer module did not change the indexing runtime version hash.
- **Evidence:** A focused indexing-version regression failed before adding the module to the explicit installer input list and passed afterward.
- **Approaches tried:**
  - **Attempt:** Rely on the existing installer file's entry in the hash.
    - **Outcome:** Partial
    - **Why:** It covers the initial import change, not later edits to the imported module.
  - **Attempt:** Add the new script to the input list and exercise its content change in a mock project.
    - **Outcome:** Worked
    - **Why:** The hash now changes when the module changes independently.
- **Root cause:** The version collector automatically discovers indexing core modules but enumerates installer scripts explicitly.
- **Resolution:** Include `indexing-semantic-smoke-runner.js` in the installer input list and test its contribution to the hash.
- **Verification:** The focused `indexing-version.test.ts` test was red before the collector update and green afterward; `npm run check`, full `./test.sh`, and `./reinstall.sh` also passed.
- **Prevention/follow-up:** When adding an indexing installer script, extend the explicit hash input list and its focused test in the same change.
- **Reusable learning:** A newly extracted runtime module needs independent version-hash coverage; hashing only its caller is not enough.
- **References:** `packages/coding-agent/src/core/indexing-version.ts`, `packages/coding-agent/test/indexing-version.test.ts`
