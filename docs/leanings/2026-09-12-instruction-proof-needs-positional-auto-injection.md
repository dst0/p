# 2026-09-12 — Instruction proof needs positional auto-injection

- **Status:** Resolved
- **Task/context:** Proving equivalent automatic project-instruction loading across benchmark agents.
- **Unexpected observation or failure:** A single tail receipt could be recovered with an explicit file read and did not detect instruction truncation.
- **Evidence:** A malicious mock that emitted a visible read still satisfied the former content-only check.
- **Approaches tried:**
  - **Attempt:** Search the final response for one receipt.
    - **Outcome:** Did not work
    - **Why:** It proved possession, not automatic loading, exact response behavior, or full-document delivery.
  - **Attempt:** Require exact independently randomized head, middle, and tail receipts with zero visible tool activity.
    - **Outcome:** Worked
    - **Why:** Reading the file becomes observable and positional omission breaks the proof.
- **Root cause:** The proof conflated content recovery with implicit instruction injection.
- **Resolution:** Preflight now accepts only the exact three-part response and rejects all user-visible file/tool activity.
- **Verification:** `certification-instruction-auto-injection.test.ts` exercises honest loading, visible reads, and positional challenge construction.
- **Prevention/follow-up:** Instruction-delivery proofs must test both provenance and coverage, not merely a returned substring.
- **Reusable learning:** Use independent positional canaries plus a no-tool invariant to prove automatic full-document loading.
- **References:** `benchmarks/test/workloads/certification-instruction-auto-injection.test.ts`
