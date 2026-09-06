# 2026-09-06 — Release packaging inputs must be certified

- **Status:** Resolved
- **Task/context:** Audited the release certificate input scope in `scripts/release-inputs.js` while adding regression coverage for the local release and publication pipeline.
- **Unexpected observation or failure:** The selector covered release-audit JavaScript, workspace manifests, changelogs, shrinkwraps, and change fragments, but omitted four present implementation files: `scripts/build-binaries.sh`, `scripts/local-release.js`, `scripts/npm-pack-result.js`, and `scripts/publish.js`. A focused regression was RED before the source change because adding all four files still selected none of them.
- **Evidence:** `node --test --test-concurrency=1 scripts/release-packaging-inputs.test.js` exited 1 at the positive worktree-scope assertion with all four packaging paths absent. After the source change, the same test exited 0 with one test passed; it also verified the absent historical fixture revision, worktree and revision hash changes, per-file mutations, and exclusion of its own `.test.js` file.
- **Approaches tried:**
  - **Attempt:** Evaluate the four paths as required inputs for every audited revision.
    - **Outcome:** Partial
    - **Why:** Inspection confirmed the paths matter for current release provenance, but historical release fixtures and revisions predating individual helper files legitimately lack one or more paths, so making them required would reject valid old revisions.
  - **Attempt:** Add an explicit optional-if-present path set to the selector.
    - **Outcome:** Worked.
    - **Why:** Current worktrees and revisions bind present packaging implementations without making old revisions fail closed on files they never contained.
- **Root cause:** `selectedInputPaths()` had no explicit scope for packaging helpers outside the `scripts/release*.js` rule; shell, local-release, pack-result, and publish implementations therefore remained outside the intended release-input hash.
- **Resolution:** Added an optional-if-present `OPTIONAL_RELEASE_INPUTS` set and included those paths in both worktree and Git-revision selection through the shared selector.
- **Verification:** Focused RED/GREEN regression: `scripts/release-packaging-inputs.test.js`. The test confirms test files remain excluded, all four current implementations are selected, absent historical inputs remain valid, and worktree/revision hashes change when certified packaging content changes.
- **Prevention/follow-up:** Keep release pipeline implementations in the explicit certified input scope and add any future packaging authority through the same optional-if-present mechanism when historical revisions may predate individual helpers. The exact certified base SHA and existing release mutation-path checks remain independent safeguards; this finding establishes intended input-hash coverage, not a reproduced arbitrary certificate or publication bypass.
- **Reusable learning:** Every file that controls release packaging, artifact validation, or publication must either be explicitly required or be selected when present; broad filename patterns are not a complete provenance inventory.
- **References:** `scripts/release-inputs.js`; `scripts/release-packaging-inputs.test.js`; `package.json` (`test:release-audit`).
