# 2026-08-26 — User overrides require authoritative prompts

- **Status:** Resolved
- **Task/context:** Adding a durable file-size completion gate to task verification in `packages/coding-agent`.
- **Unexpected observation or failure:** The first override check searched the controller's combined task text, so a model-authored task summary, a referenced instruction file, or an incidental phrase such as "split this large file" could disable the guard without explicit user authorization.
- **Evidence:** Adversarial review traced the bypass to `taskText()`, which combines user prompts, task summaries, and prepared requirement-source text. Failing regressions reproduced all three authority mistakes before the fix.
- **Approaches tried:**
  - **Attempt:** Reuse the existing broad file-size override pattern against combined task text.
    - **Outcome:** Did not work
    - **Why:** The text mixed authoritative user intent with model-controlled and attached-document content, while broad nouns such as "large file" did not prove permission.
  - **Attempt:** Derive authorization only from captured user-message text and require an explicit override clause.
    - **Outcome:** Worked
    - **Why:** It preserves normal task context while excluding task summaries and extracted instruction sources from the authorization boundary.
- **Root cause:** Convenience text aggregation erased provenance at a security-sensitive policy decision.
- **Resolution:** `userFileSizeOverrideIsAuthorized()` now reads only persisted user prompts, with authoritative user-context fallbacks. It scans messages newest-first, gives explicit denial or revocation precedence within each message, and requires explicit grant verbs or limit-waiver language.
- **Verification:** Focused tests prove that model summaries, attached source text, "split this large file," negated grants, and later revocations remain blocked, while a newer grant captured through the real user-message event path survives restore and permits completion.
- **Prevention/follow-up:** Treat every user-only override as an authority check. Preserve message provenance through policy evaluation instead of searching aggregated prompt or document text.
- **Reusable learning:** Never infer user authorization from a text aggregate containing model output or attached instructions, even when the aggregate is otherwise suitable for requirement discovery.
- **References:** `packages/coding-agent/src/core/task-verification/user-file-size-override.ts`, `packages/coding-agent/test/task-verification-source-size-persistence.test.ts`
