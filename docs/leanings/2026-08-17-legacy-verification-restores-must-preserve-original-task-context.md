# 2026-08-17 — Legacy verification restores must preserve original task context

- **Status:** Resolved
- **Task/context:** Extending high-risk acceptance guidance and requirement hashing to use every persisted user prompt.
- **Unexpected observation or failure:** A restored version-2 verification state without the new `taskPrompts` field fell back directly to the benign model-authored task summary, silently dropping the original high-risk `taskContext`.
- **Evidence:** A focused restored-state regression recorded a successful broad unit suite at mutation revision 1 and received no `HIGH-RISK ACCEPTANCE AUDIT REQUIRED` guidance even though the persisted context described crash recovery and transactional writes.
- **Approaches tried:**
- **Attempt:** Treat `taskSummary` as the universal compatibility fallback for states without prompt entries.
- **Outcome:** Did not work
- **Why:** The summary is not authoritative source text and can omit the lifecycle or durability terms that trigger stricter acceptance guidance.
- **Attempt:** Prefer the persisted legacy `taskContext` with a stable synthetic source ID, using the summary only when neither prompt representation exists.
- **Outcome:** Worked
- **Why:** Restored states retain their original user-authored risk signal while new states continue to use their complete ordered prompt entries.
- **Root cause:** The prompt aggregation migration preserved the new representation but ordered its compatibility fallbacks incorrectly.
- **Resolution:** Change `sourcePromptsForState` fallback order to `taskPrompts`, legacy `taskContext`, then `taskSummary`.
- **Verification:** Focused regressions now prove both a later high-risk user clarification and a restored legacy high-risk context produce the mandatory broad-suite acceptance warning.
- **Prevention/follow-up:** Every state-schema migration must test restored prior-version records at the downstream policy decision, not only serialization round trips.
- **Reusable learning:** Compatibility fallbacks must preserve the most authoritative persisted input; a derived summary must never replace surviving original user context.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-audit-hashing.ts`, `packages/coding-agent/test/task-verification-high-risk-acceptance.test.ts`
