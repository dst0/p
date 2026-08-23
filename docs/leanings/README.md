# Learning records

This directory is the repository-wide, append-only collection of durable engineering learnings. Each learning lives in its own Markdown file so changes remain focused, searchable, and easy to review.

## When to add a learning

Create a learning when work reveals a resolved bug or regression, a failed or misleading experiment, unexpected behavior, a setup or environment trap, a non-obvious constraint, an important workaround, or a rejected approach whose rationale should be reused.

Routine successful work does not need a learning unless it produced a generalizable insight. Sanitize all evidence and never include credentials, tokens, private keys, customer data, sensitive payloads, or unsanitized production information.

## File convention

- Create exactly one learning per file.
- Name it `YYYY-MM-DD-short-descriptive-title.md` using the learning date and a lowercase ASCII kebab-case title.
- Keep the filename stable after publication. If a later discovery changes the understanding, create a new dated file and link the earlier learning.
- Keep published learning files append-only by default. Do not delete or rewrite them merely to make the history cleaner.
- If authoritative evidence proves a learning was fabricated, hallucinated, or factually false, correct or remove the false content in the affected file, set its status to `Corrected`, and add a dated correction note with the authoritative evidence and exact correction. Do not repeat removed sensitive content.
- If evidence is incomplete or disputed, preserve the original file and create a linked `Partial` or `Open` follow-up file.

`README.md` defines the collection and is not itself a learning record.

## Learning template

```markdown
# YYYY-MM-DD — Short descriptive title

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
