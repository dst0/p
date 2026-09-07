# 2026-09-06 — Readback fixtures need supported effect domains

- **Status:** Resolved
- **Task/context:** Integrate new effect-ledger freshness regressions into the release validation run.
- **Unexpected observation or failure:** Focused Vitest and targeted formatting passed, but the full TypeScript check rejected a readback fixture's `string[]` domains. Inspection showed that the strings themselves were not supported runtime domains.
- **Evidence:** `npm run check` reported TS2322 in `task-verification-readiness-state-boundaries.test.ts`. The hand-built successful evidence used `network_read` and `remote_state`, neither of which is a valid `ToolEffectDomain`.
- **Approaches tried:**
  - **Attempt:** Construct freshness records with descriptive but invented domain strings.
    - **Outcome:** Did not work
    - **Why:** The comparator could process the unchecked fixture, but the successful state did not satisfy the production domain contract; passing the focused test was insufficient.
  - **Attempt:** Use supported `persistent_state` and `deployment` domains with a parameter typed as `TaskVerificationResolvedToolEffect["domains"]`.
    - **Outcome:** Worked
    - **Why:** Reordered-equal scopes and a distinct subset are still tested using reachable, type-checked metadata without an unsafe cast.
- **Root cause:** The direct evidence helper invented semantic labels instead of reusing the canonical domain union. Vitest's execution path did not substitute for the separate TypeScript gate.
- **Resolution:** Correct the values and helper type. Keep production validation unchanged and retain the separate same-scope and subset assertions.
- **Verification:** The corrected state-boundary suite passed 6/6 tests, targeted Biome passed, and the parent reruns the complete check and canonical coverage suite as delivery gates.
- **Prevention/follow-up:** Successful-state fixtures must use canonical runtime types and supported domain values. Deliberately invalid values belong in explicit malformed-state rejection tests, not success or freshness tests.
- **Reusable learning:** A focused test can pass with an impossible fixture; establish production validity independently before treating its assertions as behavioral evidence.
- **References:** `packages/coding-agent/test/task-verification-readiness-state-boundaries.test.ts`; `packages/agent/src/tool-effects.ts`; `AGENTS.md`; `2026-08-30-task-verification-fixtures-need-valid-lifecycle-state.md`.
