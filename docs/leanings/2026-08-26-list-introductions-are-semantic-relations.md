# 2026-08-26 — List introductions are semantic relations

- **Status:** Resolved
- **Task/context:** Making compiled project instructions preserve arbitrary user and referenced-document requirements without retaining a large monolithic prompt.
- **Unexpected observation or failure:** Flattened list items could be mapped as independent positive requirements even when an ancestor introduced a universal prohibition, nested subject, or choice/cardinality group.
- **Evidence:** Focused regressions reproduced positive reversal of `Never` lists, split alternatives from an exactly-one group, lost nested subjects, undeclared exceptions, contradictory text versus acceptance criteria, and the `news`/`new` terminal-`s` collision.
- **Approaches tried:**
  - **Attempt:** Validate each flattened clause from local token overlap and a negative marker.
    - **Outcome:** Did not work
    - **Why:** Local overlap loses ancestor subjects and relational scope; an unrelated negative phrase or one correct field could mask a reversed proposition elsewhere.
  - **Attempt:** Preserve introduction ancestry and validate the complete protected proposition, ordered conditions, polarity across fields, and coordinated choice-group coverage.
    - **Outcome:** Worked
    - **Why:** The validator retains structural relationships while remaining independent of task domain or a fixed action vocabulary.
- **Root cause:** Clause extraction represented list ancestry as display context, while validation treated descendants as semantically independent bags of stemmed tokens.
- **Resolution:** Retain `introducedByClauseId`, construct effective clauses from every ancestor, enforce inherited qualifiers and negative propositions, keep choice/cardinality siblings coordinated, reject undeclared conditions and positive reversals, and use conservative inflection normalization.
- **Verification:** `task-requirement-source-list-context.test.ts`, `task-requirement-source-list-group-semantics.test.ts`, and the wider requirement/prompt test surface cover coding-neutral operational examples, nested lists, quantifiers, polarity, conditions, and inflection edge cases.
- **Prevention/follow-up:** Keep structural list relations in the source catalog and add adversarial regressions for any new qualifier, boundary, or normalization rule. The paired task benchmark remains the end-to-end performance gate.
- **Reusable learning:** Never flatten a list without preserving the semantic relation introduced by its ancestors; scope, polarity, subject, and sibling cardinality are part of each leaf requirement.
- **References:** `packages/coding-agent/src/core/task-verification/requirement-clause-context.ts`, `packages/coding-agent/test/task-requirement-source-list-group-semantics.test.ts`
