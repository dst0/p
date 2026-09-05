# 2026-08-30 — Node image download browser boundary

- **Status:** Resolved
- **Task/context:** Add socket-bound SSRF protection without breaking the browser-safe `@dst0/p-ai` root export.
- **Unexpected observation or failure:** A static import of the Node DNS and HTTP downloader caused `npm run check:browser-smoke` to fail because the root package graph tried to bundle `node:dns`, `node:http`, and `node:https` for browsers.
- **Evidence:** The browser smoke error log named all three unresolved Node built-ins from `packages/ai/src/utils/image-download.ts`.
- **Approaches tried:**
  - **Attempt:** Import the secure Node downloader directly from the browser-visible image provider.
    - **Outcome:** Did not work
    - **Why:** Root ESM exports make static imports part of the browser bundle graph even when the code path is not executed.
  - **Attempt:** Inject remote download behavior into the provider and expose the Node implementation through a dedicated package subpath.
    - **Outcome:** Worked
    - **Why:** Base64 image generation remains browser-safe; Node callers opt into the socket-bound downloader, while browsers fail closed for remote URL responses.
- **Root cause:** Runtime-specific transport code crossed the package's browser-safe root boundary.
- **Resolution:** Added the `@dst0/p-ai/utils/image-download` Node subpath, removed it from the root export graph, and made remote URL downloading an explicit provider option supplied by coding-agent.
- **Verification:** `npm run check:browser-smoke` passes, and coding-agent focused tests resolve and exercise the Node subpath.
- **Prevention/follow-up:** Keep Node built-ins outside browser-visible root imports. Use explicit runtime adapters or conditional package boundaries for Node-only transports.
- **Reusable learning:** Browser-safe provider logic may parse base64 everywhere, but DNS-bound remote downloads belong behind an explicit Node-only adapter boundary.
- **References:** `packages/ai/package.json`, `packages/ai/src/providers/images/openai.ts`, `packages/coding-agent/src/core/tools/generate-image.ts`
