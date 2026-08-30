# 2026-08-30 — Image provider root-import laziness

- **Status:** Resolved
- **Task/context:** Add official OpenAI and LLM-orchestrator image generation without changing the browser-safe root import contract of `@dst0/p-ai`.
- **Unexpected observation or failure:** The focused image tests passed, but the package lazy-load regression showed that importing the root module eagerly loaded the OpenAI SDK after image providers were registered statically.
- **Evidence:** `lazy-module-load.test.ts` failed only after the image adapters were added to the built-in registry and passed after their HTTP transport stopped importing the SDK.
- **Approaches tried:**
  - **Attempt:** Reuse the OpenAI SDK inside the image provider adapter.
    - **Outcome:** Rejected.
    - **Why:** Static provider registration made that dependency part of the root import graph and broke the package's lazy-loading contract.
  - **Attempt:** Use a small fetch-based image JSON transport with explicit response bounds.
    - **Outcome:** Worked.
    - **Why:** The transport remains browser-safe, preserves the one-shot endpoint contract, and independently enforces response limits.
- **Root cause:** A provider registered from the root graph cannot import a heavyweight or runtime-specific client without making that client eager too.
- **Resolution:** Added a browser-safe bounded JSON transport for OpenAI-compatible image generation and kept the Node-only downloader behind an explicit package subpath and injected adapter.
- **Verification:** `lazy-module-load.test.ts`, `image-http.test.ts`, `openai-images-unit.test.ts`, and the browser smoke check cover the import and transport boundaries.
- **Prevention/follow-up:** Treat every statically registered provider as part of the root import budget. Keep runtime-specific I/O behind explicit adapters or subpath exports.
- **Reusable learning:** Dependency direction, not only code execution, determines whether a supposedly optional provider stays lazy.
- **References:** `packages/ai/src/providers/images/image-http.ts`, `packages/ai/src/providers/images/openai.ts`, `packages/ai/src/providers/images/register-builtins.ts`
