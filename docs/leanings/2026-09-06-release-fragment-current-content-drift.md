# 2026-09-06 — Release evidence must compare current fragment content

- **Status:** Resolved
- **Task/context:** Validate bounded historical release-fragment exceptions while retaining strict enforcement for current changes.
- **Unexpected observation or failure:** The audit accepted a changed current fragment package or justification when its ID and the total number of fragments stayed the same.
- **Evidence:** `release-change-fragment-provenance.test.js` reproduced a missing expected exception for an uncommitted package remap. The audit only compared current IDs against historical introductions.
- **Approaches tried:**
  - **Attempt:** Rely on the certificate's release-input hash alone.
    - **Outcome:** Rejected during review.
    - **Why:** That hash binds current bytes but does not establish agreement between those bytes and historical fragment evidence.
  - **Attempt:** Compare current and historical fragment content hashes.
    - **Outcome:** Worked.
    - **Why:** Content changes now fail even when paths, IDs, and counts are preserved.
- **Root cause:** The introduction check tested membership without comparing the stored content hash. Historical Git reads also trim surrounding whitespace while current file reads retain the final newline.
- **Resolution:** Compare both membership and normalized content hashes. Keep raw release-input hashing unchanged so certificates still bind exact source bytes. The parser was extracted to keep responsibilities readable within the file-size limit.
- **Verification:** The regression failed before the fix, then passed for package remapping, justification replacement, and restoration of original content. The focused release tests passed 17/17.
- **Prevention/follow-up:** Keep content comparisons in the full provenance path; a valid ID or a current-input certificate alone cannot establish historical agreement.
- **Reusable learning:** Evidence linking current artifacts to history must compare the artifact content, using a defined normalization shared by both readers.
- **References:** `scripts/release-change-fragment-provenance.test.js`, `scripts/release-fragment-parser.js`, `scripts/release-change-fragments.js`
