# 2026-09-06 — Measure instruction injection separately from the full system prompt

- **Status:** Resolved
- **Task/context:** Verify the installed release-candidate SDK and CLI using an isolated, provider-free fixture outside the repository.
- **Unexpected observation or failure:** An ad-hoc smoke asserted that `session.systemPrompt.length` must be below 5,000 and failed, although the project-instruction implementation's existing budget regressions passed.
- **Evidence:** The exact-fit fixture produced a 953-character project-instruction block inside a 15,485-character assembled system prompt. The additional context preceded the project-instruction block or contained final session metadata. These fixture-specific character counts are not token counts, a production bound, or latency evidence.
- **Approaches tried:**
  - **Attempt:** Apply the project-instruction cap to the complete SDK system prompt.
    - **Outcome:** Did not work; it tested a different contract.
    - **Why:** The full prompt also contains built-in assistant/tool and verification guidance, which is outside the injected segment budget.
  - **Attempt:** Measure the nonempty injected block, any per-turn route, and assembly separators separately, while recording total prompt size independently.
    - **Outcome:** Worked with the existing processor, routing, and session budget contract.
    - **Why:** Runtime enforcement compares the prepared project-instruction prompt and route, not the complete system prompt.
- **Root cause:** An ambiguous measurement scope in the smoke assertion conflated one bounded context component with the complete assembled request; this was not a runtime budget regression.
- **Related measurement boundary:** Compiled and legacy modes both use a `project_instructions` element. Identify the compiled block by its `agents_sha256` attribute; the legacy block instead carries a source `path`. A prefix-only substring check cannot distinguish those delivery modes.
- **Resolution:** Correct the isolated smoke measurement and clarify the scope in the canonical project-instruction documentation and its generated site copy. Keep runtime code unchanged.
- **Verification:** The installed SDK checks default compiled delivery, explicit legacy/off delivery, evidence verification, exact-fit provider avoidance, and the instruction-segment budget. Existing `project-instructions-session.test.ts` and routing regressions check the same budget boundary.
- **Prevention/follow-up:** Report injected instruction characters, full system-prompt characters, and complete provider-request tokens as separate measurements. Require a complete correctness-gated paired experiment before claiming lower latency or total token use.
- **Reusable learning:** A component budget cannot establish an end-to-end context or performance bound.
- **References:** `packages/coding-agent/docs/project-instructions.md`, `packages/coding-agent/src/core/project-instructions/routing.ts`, `packages/coding-agent/test/project-instructions-session.test.ts`
