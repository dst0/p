# 2026-08-30 — Image response security boundaries

- **Status:** Resolved
- **Task/context:** Review and harden image generation responses in `@dst0/p-ai`.
- **Unexpected observation or failure:** URL responses had a 50MB streaming limit, but base64 and data URL responses decoded without a limit. URL downloads also validated DNS before calling `fetch`, allowing the connection to perform a second, unbound DNS resolution.
- **Evidence:** Focused regressions reproduced oversized base64 acceptance and confirmed that the validated DNS result was not supplied to the HTTP connection.
- **Approaches tried:**
  - **Attempt:** Pre-resolve a hostname, validate its addresses, then call hostname-based `fetch`.
    - **Outcome:** Did not work
    - **Why:** The fetch transport resolves the hostname again, leaving a DNS-rebinding time-of-check/time-of-use gap.
  - **Attempt:** Apply one decoded-byte limit to base64, data URLs, and streaming downloads, and install validation as the HTTP socket's lookup function.
    - **Outcome:** Worked
    - **Why:** Allocation is bounded before base64 decoding, and the connection consumes the exact DNS result that passed validation.
- **Root cause:** Response safety was implemented per transport path instead of as a shared untrusted-image boundary, and DNS validation was detached from socket creation.
- **Resolution:** Added a shared 50MB decoded-image hard ceiling, a 36-megapixel structural dimension ceiling, chunk/segment-aware image-envelope validation, redirect revalidation, connection-bound DNS that rejects mixed public/private answers, bounded response-body cleanup, and a 30-second download timeout.
- **Verification:** `image-mime.test.ts`, `image-http.test.ts`, `image-download.test.ts`, `openai-images-unit.test.ts`, and `openrouter-images-unit.test.ts` cover base64 boundaries, bounded JSON, malformed envelopes, special address ranges, connection-bound lookup, redirect revalidation, cleanup, abort races, and timeout behavior.
- **Prevention/follow-up:** Keep byte, pixel, and structural MIME limits shared across every new image provider. Remote download transports must bind validated addresses to the actual connection and destroy every body they do not consume. Structural checks are not a substitute for a full decoder when decoded pixels will be processed.
- **Reusable learning:** Validate and bound untrusted image bytes once at every ingestion path; SSRF DNS checks are incomplete unless the transport connects using the validated result.
- **References:** `packages/ai/src/utils/image-envelope.ts`, `packages/ai/src/utils/image-mime.ts`, `packages/ai/src/utils/image-download.ts`, `packages/ai/test/image-download.test.ts`
