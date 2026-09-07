# 2026-09-06 — Historical fragment rewrites need content-bound exceptions

- **Status:** Resolved
- **Task/context:** Finish release-audit certification after the exact governance-only exceptions were added for the `p` release history.
- **Unexpected observation or failure:** The audit then reached two later commits that rewrote the same pre-policy `None` fragment. One rewrite used a summary without the now-required reason, and the next restored the exact earlier summary; ordinary provenance checks rejected both as invalid fragment mutations. The first content-hash attempt included Git's trailing newline even though the parser hashes `.trim()` output, so the preview correctly rejected the mismatched evidence.
- **Evidence:** Commits `3912148f2ac2fe3831b5010a198d5bbb70055de6` and `41543ae2fab3f17a70978c0763e890ae8ed47406` are bound by full commit ID, changed-path count, changed-path hash, affected packages, fragment path, and fragment content hash. All other fragments in those commits retain normal same-commit coverage checks.
- **Approaches tried:**
  - **Attempt:** Treat every legacy fragment rewrite as permitted.
    - **Outcome:** Rejected during review.
    - **Why:** It would weaken duplicate-fragment provenance for future changes.
  - **Attempt:** Add a reason only to the current fragment.
    - **Outcome:** Rejected during review.
    - **Why:** A later working-tree edit cannot repair historical commit evidence.
  - **Attempt:** Permit only the two exact content-bound historical rewrites.
    - **Outcome:** Worked.
    - **Why:** The exception permits the known historical content and keeps package coverage and all descendants strict.
- **Root cause:** A pre-policy benchmark fragment was rewritten during the policy-introduction and recovery sequence before the release audit had a migration record for that legacy fragment.
- **Resolution:** Historical exceptions distinguish packages allowed to lack coverage from fragment rewrites that retain normal coverage; the latter require an exact path and both previous and replacement content hashes.
- **Verification:** Focused tests verify both legacy contents and the rewrite/recovery hash chain. Full-history preview and the containing release suite are separate delivery gates.
- **Prevention/follow-up:** Never broaden the legacy-fragment matcher. Any additional historical exception requires a reviewed full-SHA, changed-path, affected-package, path, and content-hash entry.
- **Reusable learning:** Provenance migrations must bind both the commit scope and the exact legacy artifact content; path-only exceptions are insufficient for rewritten fragments.
- **References:** `scripts/release-historical-fragment-exceptions.js`, `scripts/release-change-fragments.js`, `scripts/release-change-fragment-provenance.test.js`

## 2026-09-06 — Rebase identity refresh

Rebasing the unpublished release branch onto `722122dae60d9c508ce45ef77ec97bf3c79b86c9` preserved the stable patch IDs of all 76 task commits and the complete path sets of all four branch-local exceptions. The policy-introduction and recovery commits above became `ec4aa24e67aaf610b198753331dffc907ca76577` and `4f99a97c755281e0e85ad06ddc611631501e9888`. The registry and captured test fixtures were rebound to those identities; previous/replacement fragment hashes did not change. Earlier branch previews are not certificates for the new head.
