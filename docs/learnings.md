# Learning Log

This is the repository-wide, append-only journal for durable engineering learnings.

Add an entry when work reveals a resolved bug or regression, a failed or misleading experiment, unexpected behavior, a setup or environment trap, a non-obvious constraint, an important workaround, or a rejected approach whose rationale should be reused.

Do not add entries for routine successful work unless it produced a generalizable insight. Keep entries append-only by default and never rewrite or delete history merely to make the outcome look cleaner.

Exception: if authoritative evidence proves that an entry itself was fabricated, hallucinated, or factually false, correct or remove the false content so it cannot mislead future work. Never make that correction silently: mark the entry `Corrected` and add a dated correction note explaining what was wrong, which authoritative evidence established the error, and what changed. Do not repeat removed sensitive content. If evidence remains incomplete or disputed, preserve the original and append a `Partial` or `Open` follow-up instead.

Sanitize all evidence and never include credentials, tokens, private keys, customer data, sensitive payloads, or unsanitized production information.

## Entry template

```markdown
### YYYY-MM-DD — Short descriptive title

- **Status:** Resolved | Partial | Open | Corrected
- **Correction (only when status is `Corrected`):** Date, sanitized description of the false claim, authoritative evidence, and the exact correction made.
- **Task/context:** What work was underway and where.
- **Unexpected observation or failure:** What happened, including the visible symptom.
- **Evidence:** Logs, reproduction, measurements, or other decisive facts, sanitized as required.
- **Approaches tried:**
  - **Attempt:** What was tried.
    - **Outcome:** Worked | Did not work | Partial
    - **Why:** Why it succeeded, failed, or remained inconclusive.
- **Root cause:** The underlying cause, or the leading hypothesis and missing evidence if not confirmed.
- **Resolution:** What changed or which path is now correct.
- **Verification:** Tests, checks, or live evidence proving the result.
- **Prevention/follow-up:** Regression test, guardrail, cleanup/reset procedure, documentation update, or remaining action.
- **Reusable learning:** The concise rule future work should apply.
- **References:** Safe links or paths to issues, commits, tests, or documentation.
```

## Entries

<!-- Append new entries below this line. -->
