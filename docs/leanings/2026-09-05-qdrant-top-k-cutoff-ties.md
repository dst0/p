# 2026-09-05 — A top-k boundary tie is not a retrieval loss

- **Status:** Resolved
- **Task/context:** Compare fixed sparse queries before and after a byte-verified Qdrant storage migration.
- **Unexpected observation or failure:** Strict top-five ID equality rejected one internal query even though all copied bytes, collection metadata and scores matched. Its fourth result changed identity while both fourth and fifth positions had score 170.43457.
- **Evidence:** Expanded retrieval crossed the tie boundary and found three candidates at exactly 170.43457, including every candidate from both original top-five lists. All higher-scoring ID/score pairs matched. The other two fixed queries were unchanged.
- **Approaches tried:**
  - **Attempt:** Require literal equality of the selected top-five IDs.
    - **Outcome:** Misleading for this boundary tie.
    - **Why:** The cutoff admitted two of three equally scored candidates; a different tied member did not establish lost data or lower relevance.
  - **Attempt:** Compare the strict-above-cutoff set and verify the union of original candidates in an expanded result crossing below the exact shared cutoff.
    - **Outcome:** Worked.
    - **Why:** It proves the specific tie equivalence without accepting missing candidates, changed scores or newly higher-ranked results.
- **Root cause:** The temporary comparison oracle confused one selected top-k subset with a uniquely ranked result. The experiment establishes observed tie variation, not a universal guarantee about Qdrant tie ordering.
- **Resolution:** Preserved the original failed strict-comparison receipt and original timing samples. Added a separate successful adjudication bound to both result digests, exact query inputs, binary/config identity and full-copy proof.
- **Verification:** Focused tests accept a complete equal-score cutoff group and reject changed high-score IDs, missing candidates, changed cutoff scores, duplicate IDs and incomplete boundary expansion. A live internal diagnostic confirmed the three-member group and exited cleanly.
- **Prevention/follow-up:** Describe the result as equivalent modulo validated cutoff ties, not identical ranking. Missing candidates or failure to cross the tie boundary remain inconclusive and must not pass automatically.
- **Reusable learning:** Retrieval regression checks should distinguish substantive ranking/data changes from an explicitly verified tie at the top-k boundary.
- **References:** `packages/coding-agent/docs/code-indexing.md`; `docs/leanings/2026-09-05-qdrant-apfs-startup-comparison.md`; private original and diagnostic receipts retained on the operator host.
