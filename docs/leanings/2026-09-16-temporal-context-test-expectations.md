# 2026-09-16 - Temporal context changes exact message expectations

- **Status:** Resolved
- **Task/context:** Updating legacy prompt, queue, persistence, and cache regressions after per-turn temporal context was introduced.
- **Unexpected observation or failure:** Exact message counts and offsets became stale. An attempted route filter then excluded all valid rule messages.
- **Evidence:** Four route tests failed because the filter searched for `<project_rule_routes>` while the generated opening tag includes an `input_sha256` attribute. Three cache tests expected working state before temporal context.
- **Approaches tried:**
  - **Attempt:** Match the literal attribute-free opening tag.
    - **Outcome:** Did not work
    - **Why:** Valid attributed opening tags do not contain that literal substring.
  - **Attempt:** Match the tag name boundary and retain assertions against actual prompt content.
    - **Outcome:** Worked
    - **Why:** It excludes temporal-only messages while preserving valid rule routes.
- **Root cause:** Tests assumed the former message layout and an attribute-free tag, rather than the actual generated protocol.
- **Resolution:** Assert hidden temporal messages explicitly, preserve exact queue ordering, and update cache offsets to temporal context followed by working state.
- **Verification:** Route tests passed 5/5; corrected cache regressions passed 7/7 with exit code 0. Full repository check passed.
- **Prevention/follow-up:** Keep byte-prefix replay assertions and validate generated content before changing test parsers.
- **Reusable learning:** A new hidden message changes both persistence and provider layouts; distinguish message purpose without assuming XML-like tags have no attributes.
- **References:** `packages/coding-agent/test/project-instruction-queued-route-gates.test.ts`; `packages/coding-agent/test/suite/regressions/working-state-cache-isolation.test.ts`.
