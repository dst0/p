# 2026-09-06 — Receipt persistence errors must retain generated output

- **Status:** Resolved
- **Task/context:** Model stream receipt settlement.
- **Unexpected observation or failure:** Failure saving a final receipt replaced real response text and usage with an empty synthetic error.
- **Evidence:** A regression injected a receipt save failure after a valid provider response and failed its content/usage assertions.
- **Approaches tried:**
  - **Attempt:** Construct every admission error from an empty message.
    - **Outcome:** Did not work
    - **Why:** Post-dispatch errors differ from pre-dispatch denial.
- **Root cause:** The forwarding wrapper discarded the latest provider message before settlement finished.
- **Resolution:** Retain the latest partial or terminal message and attach the accounting error without losing its text and usage. Image receipt errors similarly preserve generated output in a structured error result.
- **Verification:** The regression passes with actual content, actual usage, and `budget_storage_error`.
- **Prevention/follow-up:** Keep terminal-result-only and streamed-consumer tests together.
- **Reusable learning:** Persistence failure may block further work but must not erase already produced work.
- **References:** `packages/ai/test/model-call-admission.test.ts`, `packages/ai/test/image-call-admission.test.ts`.
