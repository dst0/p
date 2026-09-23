# 2026-09-23 — Footer truncation must drop the least important state first

- **Status:** Resolved
- **Task/context:** Showing orchestrator queue and model-switch progress at the same time in the interactive footer (local llm-orchestrator models).
- **Unexpected observation or failure:** At 80 columns, once queue and switch were both active, the `SWITCHING` state disappeared completely. The footer stayed within width, but it cut off the reason p was waiting.
- **Evidence:** Rendering the footer at width 80 with queue, switch and loading active (realistic `mini-pc/...` model ids) contained `QUEUED` but not `SWITCHING`. The waiting states were appended after the token, cost and context stats, and the left side is truncated from the end.
- **Approaches tried:**
  - **Attempt:** Rely on the existing width-safe truncation.
    - **Outcome:** Did not work
    - **Why:** Truncation from the end removes whatever comes last, which was the live waiting state.
  - **Attempt:** Put waiting states (QUEUED, SENDING, SWITCHING, LOADING) before the stats, and drop the provider/group prefix from model ids in those states.
    - **Outcome:** Worked
    - **Why:** Narrow terminals now lose token stats first. `SWITCHING qwen3.8-27b-…` stays visible, and the target model still appears on the right.
- **Root cause:** Segments were ordered by when they were added, not by how important they are.
- **Resolution:** `footer.ts` renders waiting states first. `formatProgressModelName` in `footer-progress.ts` strips the `provider/` prefix for switch and loading labels.
- **Verification:** `test/footer-component.test.ts` renders at 80 columns and checks the width, the `QUEUED`/`SWITCHING` visibility and the ordering. Both affected tests fail with the source reverted; 40/40 focused footer tests pass.
- **Prevention/follow-up:** Test width-limited status lines at 80 columns with realistic identifiers, not only at wide widths.
- **Reusable learning:** When a status line can be truncated, order it by importance to the user and test at the narrowest common terminal width.
- **References:** `packages/coding-agent/src/modes/interactive/components/footer.ts`, `packages/coding-agent/test/footer-component.test.ts`
