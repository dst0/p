# 2026-09-12 — Streamed step costs must accumulate

- **Status:** Resolved
- **Task/context:** Collecting Kilo monetary cost for certified comparisons.
- **Unexpected observation or failure:** Each `step_finish` replaced the prior cost and malformed values could pass silently.
- **Evidence:** A multi-step fixture reported only its last cost before the accumulator was introduced.
- **Approaches tried:**
  - **Attempt:** Keep the most recently observed cost object.
    - **Outcome:** Did not work
    - **Why:** Step events are incremental rather than cumulative in all supported shapes.
  - **Attempt:** Validate and sum every numeric or `{ total }` step value.
    - **Outcome:** Worked
    - **Why:** The metric now preserves the complete stream without inventing cost from tokens.
- **Root cause:** The parser assumed one terminal cumulative cost event.
- **Resolution:** Kilo cost is accumulated across token, part, and event locations; negative, non-finite, and malformed values become metric errors.
- **Verification:** `kilo-cost-accumulation.test.ts` covers mixed multi-step forms and invalid values.
- **Prevention/follow-up:** New provider adapters must define whether cost events are increments or cumulative snapshots and test more than one step.
- **Reusable learning:** Validate monetary telemetry at ingestion and model its stream semantics explicitly.
- **References:** `benchmarks/test/workloads/kilo-cost-accumulation.test.ts`
