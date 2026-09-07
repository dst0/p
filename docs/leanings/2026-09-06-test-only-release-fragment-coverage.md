# 2026-09-06 — Test-only changes still need package release evidence

- **Status:** Resolved
- **Task/context:** Complete the release history audit after resolving governance and legacy-fragment violations.
- **Unexpected observation or failure:** `b58f9e27bc51e997b2fc05d4503dc0b3622296bd` covered coding-agent changes but omitted agent tests; `c1d6460ca592b2787b55b0c6fd4c40863bda4b34` changed only a test and learning record without any fragment.
- **Evidence:** Full Git diffs show the first omitted package adds only `packages/agent/test/model-call-preparation.test.ts`; the second adds deterministic fixture budget margin without modifying runtime code. Their complete changed-path sets contain 51 and 2 paths respectively.
- **Approaches tried:**
  - **Attempt:** Exclude every test from affected-package classification.
    - **Outcome:** Rejected during review.
    - **Why:** This would silently alter the general release policy and hide future test-only evidence changes.
  - **Attempt:** Bind exceptions to the exact historical commits and only their omitted packages.
    - **Outcome:** Worked.
    - **Why:** The mixed commit still needs its coding-agent fragment while its agent-only test omission is explicitly recorded.
- **Root cause:** Historical commits omitted internal `None` fragments for tests even though the classifier includes all files under the published packages.
- **Resolution:** Record full commit IDs, path counts and hashes, affected packages, and the exact allowed missing package subset. All other coverage checks remain active.
- **Verification:** Captured Git scope fixtures verify all seven entries, reject changed paths or commit IDs, and compare exemptions to actually omitted packages. Focused release tests passed 17/17.
- **Prevention/follow-up:** Include a `None` fragment with a specific reason for future internal test-only changes. Inspect the entire policy-era range before attempting a release migration.
- **Reusable learning:** In a mixed commit, exempt only the reviewed omission rather than granting the whole commit an unconditional coverage bypass.
- **References:** `scripts/release-historical-fragment-exceptions.js`, `scripts/fixtures/release-historical-fragment-scopes.json`, `scripts/release-historical-fragment-exceptions.test.js`

## 2026-09-06 — Rebase identity refresh

The verified rebase onto `722122dae60d9c508ce45ef77ec97bf3c79b86c9` maps the two commits above to `5cf86d4d9441ceff1f15e6129d7110bca2d3f462` and `2db67221fabc077df03b1412b93375f177dc42f4`. Stable patch IDs and complete changed-path sets were unchanged. Only the exact commit bindings were refreshed; allowed missing packages and path hashes remain identical.
