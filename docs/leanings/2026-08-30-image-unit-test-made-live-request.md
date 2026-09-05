# 2026-08-30 — Image unit test made a live request

- **Status:** Resolved
- **Task/context:** Run the focused image-provider suite while reviewing image generation.
- **Unexpected observation or failure:** `openrouter-images-unit.test.ts` used a dummy credential but invoked the real SDK transport, causing the focused run to wait on an external network failure instead of testing a deterministic unit contract.
- **Evidence:** The Vitest process remained active with only the suite startup line in its log until the exact focused process was interrupted.
- **Approaches tried:**
  - **Attempt:** Treat a failed request with a dummy key as the expected unit-test result.
    - **Outcome:** Did not work
    - **Why:** DNS, routing, remote latency, and SDK timeouts control the test result and duration.
  - **Attempt:** Replace the SDK transport with a file-local fake and assert the complete request and response behavior.
    - **Outcome:** Worked
    - **Why:** The test now verifies payload construction, image input, MIME validation, and the shared size limit without network access.
- **Root cause:** The test asserted an incidental external failure rather than the provider adapter's behavior.
- **Resolution:** Replaced the live request with a deterministic OpenAI SDK fake and added positive and oversized-response assertions.
- **Verification:** The six-file AI image suite completes locally with 43 passing tests in under one second.
- **Prevention/follow-up:** Provider unit tests must fake network transports. Keep paid or live provider checks in explicit integration suites guarded by environment variables.
- **Reusable learning:** A dummy API key does not make an SDK request a unit test; deterministic tests must own the transport and assert the contract.
- **References:** `packages/ai/test/openrouter-images-unit.test.ts`
