# 2026-09-08 — Filter unknown recovered JSON tools

- **Status:** Resolved
- **Task/context:** Filtering false misplaced-tool recovery in the agent loop (`packages/agent/src/agent-loop/tool-dispatch.ts`).
- **Unexpected observation or failure:** Illustrative JSON/JSONC fenced code blocks and raw thinking JSON payloads containing unregistered tool names (such as `{"name":"hypothetical_tool","arguments":{...}}`) were parsed and treated as tool calls, triggering unintended tool execution, error results, and continuation turns.
- **Evidence:** Regression tests in `packages/agent/test/misplaced-json-tool-recovery.test.ts` demonstrated that assistant outputs with unknown tool names in fenced JSON/JSONC or raw thinking JSON emitted error tool results and advanced the turn loop (`callIndex === 2`) instead of completing normally (`callIndex === 1`), even when the registered tool set was empty.
- **Approaches tried:**
  - **Attempt:** Filter tool calls in the JSON-recovery path against the registered tool-name set, while preserving the explicit XML `<tool_call>` path that intentionally creates error tool results for unknown tools.
    - **Outcome:** Worked
    - **Why:** Misplaced JSON extraction now requires that parsed tool names exist in the registered tool-name set (returning an empty array when the tool set is empty or the name is unknown), preventing false recovery side effects without altering explicit XML semantics.
- **Root cause:** `extractMisplacedJsonToolCalls` extracted any JSON structure matching tool shapes without checking whether the parsed tool name was registered in `tools`.
- **Resolution:** Updated `extractMisplacedJsonToolCalls` in `packages/agent/src/agent-loop/tool-dispatch.ts` to accept `ReadonlySet<string>` and require `toolNames.has(call.name)`, returning an empty array when `toolNames.size === 0`.
- **Verification:** Ran focused Vitest suite `packages/agent/test/misplaced-json-tool-recovery.test.ts` (8 passing tests covering raw thinking JSON, fenced JSON/JSONC, empty tool set, registered tools, and explicit XML unknown tools), verified clean `git diff --check`, and passed Biome checks.
- **Prevention/follow-up:** Dedicated regression test suite `packages/agent/test/misplaced-json-tool-recovery.test.ts` asserts that unregistered tool names in JSON/JSONC fences and raw thinking blocks never trigger tool execution or loop continuation.
- **Reusable learning:** Heuristic or recovery parsers operating on unformatted or weakly-structured text/code fences must validate extracted entities against the active registry before dispatching actions.
- **References:** `packages/agent/src/agent-loop/tool-dispatch.ts`, `packages/agent/test/misplaced-json-tool-recovery.test.ts`
