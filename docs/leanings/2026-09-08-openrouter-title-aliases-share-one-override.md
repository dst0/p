# 2026-09-08 — OpenRouter title aliases share one override

- **Status:** Resolved
- **Task/context:** Release-readiness review of automatic OpenRouter attribution headers.
- **Unexpected observation or failure:** A caller-provided legacy `X-Title` header was preserved but the helper also injected the canonical `X-OpenRouter-Title: p` default.
- **Evidence:** The OpenRouter app-attribution contract still supports `X-Title` for backward compatibility, and the focused regression observed both title headers in the merged request.
- **Approaches tried:**
  - **Attempt:** Detect only exact case-insensitive `X-OpenRouter-Title` overrides.
    - **Outcome:** Did not work
    - **Why:** It treated the supported legacy alias as an unrelated header and injected a competing default.
  - **Attempt:** Treat either supported title header as an override of the default title.
    - **Outcome:** Worked
    - **Why:** Caller intent remains unambiguous while canonical defaults are still supplied when neither alias is present.
- **Root cause:** Default suppression normalized casing but did not normalize the provider's backward-compatible semantic aliases.
- **Resolution:** Suppress the canonical title default when either `X-OpenRouter-Title` or `X-Title` is already present, case-insensitively.
- **Verification:** `openrouter-attribution-headers.test.ts` reproduces the duplicate-title failure and verifies the legacy override remains the only title header.
- **Prevention/follow-up:** Model provider-supported header aliases as one semantic field when merging user overrides with defaults.
- **Reusable learning:** Case-insensitive header merging is insufficient when an API supports multiple names for the same semantic field.
- **References:** `packages/ai/src/providers/openrouter-headers.ts`, `packages/ai/test/openrouter-attribution-headers.test.ts`, OpenRouter app-attribution documentation.
