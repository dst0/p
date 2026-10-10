# 2026-09-28 — Model evidence requires complete bounded stream records

- **Status:** Resolved
- **Task/context:** Attribute each certified completion response to the expected model.
- **Unexpected observation or failure:** An SSE stream truncated by its final delimiter byte could still contribute model evidence.
- **Evidence:** A regression removing exactly the terminal delimiter reproduced the false acceptance.
- **Approaches tried:**
  - **Attempt:** Append a newline at EOF and accept a parsed `data:` line.
    - **Outcome:** Did not work.
    - **Why:** EOF was treated as evidence of a completed SSE event even when framing was truncated.
- **Root cause:** The collector counted model fields before the SSE event delimiter and implicitly completed the stream at EOF.
- **Resolution:** Count models only from fully delimited events; reject incomplete trailing data and bound line size and event count.
- **Verification:** Focused tests remove the final delimiter, truncate a later event after a valid one, and exercise oversized lines and excess small events.
- **Prevention/follow-up:** Keep framing tests at the exact byte boundary, not only whole-record truncations.
- **Reusable learning:** Parse transport framing before using response content as certification evidence.
- **References:** `benchmarks/src/harness/certified-proxy-response-models.ts`, `benchmarks/test/harness/certified-proxy-response-models.test.ts`.
