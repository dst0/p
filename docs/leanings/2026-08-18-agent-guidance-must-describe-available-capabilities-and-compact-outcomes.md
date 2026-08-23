# 2026-08-18 — Agent guidance must describe available capabilities and compact outcomes

- **Status:** Resolved
- **Task/context:** Reviewing the coding-agent system-prompt guidance added for context-efficient tool use.
- **Unexpected observation or failure:** The prompt unconditionally demanded parallel subagents, treated local `semantic_search` as proof of web access, and named a repository-local testing skill that is not necessarily loaded or shipped to the running agent.
- **Evidence:** Focused prompt regressions showed the subagent instruction with only `read` and `bash`, and showed web-research guidance when the only search capability was local semantic code search.
- **Approaches tried:**
  - **Attempt:** Encode a particular parallel workflow and named skill directly in the default prompt.
    - **Outcome:** Did not work
    - **Why:** The prompt can only rely on tools and skills actually supplied to that agent instance; prescribing unavailable mechanisms creates impossible work and distracts from the output-control objective.
  - **Attempt:** State the desired observable outcome and condition web guidance on web-capable tools.
    - **Outcome:** Worked
    - **Why:** The agent can choose an available harness, quiet reporter, or wrapper while returning only `PASS` or `FAIL` with the decisive reason and authoritative exit code.
- **Root cause:** The original guidance conflated the goal of minimizing model-visible tool output with one optional orchestration mechanism and inferred capabilities from a broad name match.
- **Resolution:** Remove the subagent demand, distinguish local semantic search from web tools, reference only loaded skills generically, and require planning the smallest useful command plus compact outcome reporting while retaining full logs outside model context.
- **Verification:** `packages/coding-agent/test/system-prompt.test.ts` passes and explicitly rejects both subagent wording and the hard-coded `test-output-discipline` skill name.
- **Prevention/follow-up:** Prompt tests must exercise both the presence and absence of capability-dependent guidance.
- **Reusable learning:** Specify the output contract and detected capabilities, not an unavailable tool, skill, or orchestration strategy.
- **References:** `packages/coding-agent/src/core/system-prompt.ts`, `packages/coding-agent/test/system-prompt.test.ts`
