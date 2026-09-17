# 2026-09-08 — Case-insensitive header defaults

- **Status:** Resolved
- **Task/context:** Add default OpenRouter attribution headers to the `packages/ai` text and image request paths while preserving configured headers.
- **Unexpected observation or failure:** Merging model and request header objects with object spread or `Object.assign` retained two keys when the same HTTP header used different casing.
- **Evidence:** A focused regression supplied duplicate model-level casing variants followed by a request-level override; flattening the layers first let the stale model variant win instead of the request value. An adversarial follow-up also showed that assigning an own `__proto__` header onto a plain object invoked the inherited setter and silently dropped the data property.
- **Approaches tried:**
  - **Attempt:** Check case-insensitively only before inserting default headers.
    - **Outcome:** Did not work
    - **Why:** It prevented a default duplicate but did not collapse case variants already introduced by layered configuration.
  - **Attempt:** Merge each configured OpenRouter header layer case-insensitively in precedence order before adding missing defaults.
    - **Outcome:** Worked
    - **Why:** Later request entries replace earlier model entries regardless of casing, and defaults are added only for absent logical header names.
- **Unexpected constraint:** Header names are untrusted data keys, so accumulation must define own data properties rather than rely on inherited object setters.
- **Root cause:** HTTP header names are case-insensitive, but JavaScript object keys and ordinary object merges are case-sensitive.
- **Resolution:** The centralized OpenRouter helper now merges model and request layers case-insensitively with later layers winning, defines configured headers as own data properties, then inserts canonical defaults only when needed. Non-OpenRouter URLs retain exact object-merge semantics.
- **Verification:** `openrouter-attribution-headers.test.ts` and `openrouter-images-unit.test.ts` passed all 13 focused tests, including the prototype-setter collision regression.
- **Prevention/follow-up:** Test both default insertion and same-header model/request overrides with alternate casing whenever headers are layered as objects.
- **Reusable learning:** Normalize or deduplicate logical HTTP header names case-insensitively before applying precedence or defaults.
- **References:** `packages/ai/src/providers/openrouter-headers.ts`, `packages/ai/test/openrouter-attribution-headers.test.ts`
