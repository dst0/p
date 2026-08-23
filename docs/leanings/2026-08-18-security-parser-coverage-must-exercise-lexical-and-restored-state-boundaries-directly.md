# 2026-08-18 — Security parser coverage must exercise lexical and restored-state boundaries directly

- **Status:** Resolved
- **Task/context:** Fixing the first CI run for the recent coding-agent hardening review.
- **Unexpected observation or failure:** Every functional suite passed, but the changed-line gate reported 90.34% because the end-to-end publication regression did not execute escape handling, option-separator exits, malformed nested validator shapes, or the independent in-memory readiness guard.
- **Evidence:** CI reported 159/176 changed executable lines and named the exact uncovered scanner, validator, and readiness-gate lines. The local sanitized coverage harness reproduced the gap.
- **Approaches tried:**
  - **Attempt:** Rely on one broad controller regression containing many Git command variants.
    - **Outcome:** Partial
    - **Why:** It proved the main authorization outcome but did not isolate shell lexical behavior or distinguish restore validation from runtime gate revalidation.
  - **Attempt:** Add responsibility-specific tests for escaped shell words, wrapper separators, safe incomplete commands, nested state-shape rejection, and in-memory readiness tampering.
    - **Outcome:** Worked
    - **Why:** Each test now asserts a real security boundary and reaches the corresponding branch through its public or persisted behavior.
- **Root cause:** Scenario breadth was mistaken for branch diversity; several defensive paths require deliberately isolated inputs even when the main end-to-end workflow is covered.
- **Resolution:** Add dedicated Git publication-classification and restored-state-validation suites, plus a runtime readiness-tampering regression, without coverage suppressions or synthetic mocks.
- **Verification:** Sanitized full coverage passed and the changed-line checker reported 176/176 executable lines, 100.00% coverage against the PR base.
- **Prevention/follow-up:** Run the local changed-line coverage gate before first push whenever a new parser or fail-closed validator is introduced.
- **Reusable learning:** For security parsers and durable-state gates, test lexical decoding, structural validation, and runtime revalidation as separate domain responsibilities.
- **References:** `packages/coding-agent/test/task-verification-git-publication-classification.test.ts`, `packages/coding-agent/test/task-verification-restored-state-validation.test.ts`, `scripts/check-changed-coverage.js`
