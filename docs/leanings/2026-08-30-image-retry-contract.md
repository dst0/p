# 2026-08-30 — Image retry contract

- **Status:** Resolved
- **Task/context:** Replace SDK-backed image requests with a bounded fetch transport while preserving public `ImagesOptions` behavior.
- **Unexpected observation or failure:** The new transport retried retryable statuses immediately and neither image provider forwarded `maxRetryDelayMs`, despite that option being part of the public image contract.
- **Evidence:** Retry regressions observed no delay for `Retry-After` responses and received only the terminal 429 error when the requested wait exceeded the configured cap.
- **Approaches tried:**
  - **Attempt:** Retry 408, 409, 429, and 5xx responses immediately.
    - **Outcome:** Rejected.
    - **Why:** It ignores provider backpressure, can amplify rate limiting, and violates the documented delay cap.
  - **Attempt:** Parse seconds, HTTP-date, and millisecond retry headers with bounded exponential fallback.
    - **Outcome:** Worked.
    - **Why:** Provider-requested waits are honored when safe and fail visibly when they exceed the caller's configured maximum.
- **Root cause:** The transport port copied retry counts and statuses but omitted the timing part of the public retry contract.
- **Resolution:** Forwarded `maxRetryDelayMs` from OpenAI and OpenRouter, added bounded `Retry-After` parsing, cancellable sleep, exponential fallback, and response cancellation before retry.
- **Verification:** `image-http.test.ts` covers response-body cancellation, seconds and HTTP-date delays, and immediate failure when the requested wait exceeds the cap.
- **Prevention/follow-up:** When replacing an SDK transport, inventory every public transport option and test behavior rather than only request payload parity.
- **Reusable learning:** Retry count without retry timing is not contract compatibility; backpressure headers are part of safe request behavior.
- **References:** `packages/ai/src/types/message-types.ts`, `packages/ai/src/providers/images/image-http.ts`, `packages/ai/test/image-http.test.ts`
