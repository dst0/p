# 2026-08-30 — Image selector provider identity

- **Status:** Resolved
- **Task/context:** Make `/model:image` select LLM-orchestrator image models while reusing a configured OpenAI-compatible provider from `models.json`.
- **Unexpected observation or failure:** Selecting the static FLUX entry replaced the configured provider name with `llm-orchestrator`, so the next resolution no longer found the configured base URL or authentication headers.
- **Evidence:** The command-selection-to-request regression initially selected `llm-orchestrator` instead of `mini-pc-11450` and would have sent the request to the built-in localhost or environment URL.
- **Approaches tried:**
  - **Attempt:** Resolve custom provider settings only inside `AgentSession.resolveImageModel()`.
    - **Outcome:** Incomplete.
    - **Why:** The selector persisted the static provider identity before resolution ran, destroying the association it needed.
  - **Attempt:** Materialize the configured default image model as a selector item and keep its provider identity on selection.
    - **Outcome:** Worked.
    - **Why:** Selection, persistence, credential lookup, and request routing now share one stable provider key.
- **Root cause:** The UI modeled a model choice as only a static catalog entry even though endpoint and credential ownership belongs to the configured provider identity.
- **Resolution:** The selector now includes the configured default image model, marks it current, and persists its custom provider name; resolution then reuses the matching base URL, credential, and headers.
- **Verification:** `image-model-provider-chain.test.ts` covers selector confirmation, settings persistence, session resolution, header-only authentication, and the final `/v1/images/generations` request.
- **Prevention/follow-up:** End-to-end provider-selection tests must assert the final request endpoint and auth, not only the displayed model ID.
- **Reusable learning:** Provider identity is routing state. UI selection must preserve it through persistence and request construction.
- **References:** `packages/coding-agent/src/modes/interactive/components/image-model-selector.ts`, `packages/coding-agent/src/modes/interactive/interactive-mode/interactivemode-methods/model-command.ts`, `packages/coding-agent/test/image-model-provider-chain.test.ts`
