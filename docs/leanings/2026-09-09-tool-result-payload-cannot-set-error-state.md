# 2026-09-09 — Tool result payload cannot set error state

- **Status:** Resolved
- **Task/context:** Report failed single and chained subagent runs through the extension tool API.
- **Unexpected observation or failure:** The executor returned an extra `isError:true` property, but `AgentToolResult` does not contain that field and the runtime marked the tool call successful.
- **Evidence:** A real extension-runner regression invoked a missing agent and observed `tool_execution_end.isError === false` even though the result payload carried the unsupported property.
- **Approaches tried:**
  - **Attempt:** Add `isError` to the object returned by `ToolDefinition.execute`.
    - **Outcome:** Did not work
    - **Why:** Error classification belongs to the execution boundary, not the tool result payload; unknown object properties are ignored.
  - **Attempt:** Throw for failed single and chain runs.
    - **Outcome:** Worked
    - **Why:** The agent loop converts thrown execution failures into a canonical error result and sets the event and model-visible error flags.
- **Root cause:** The executor confused `AfterToolCallResult`, which may override `isError`, with `AgentToolResult`, which may not.
- **Resolution:** Failed single and chain subagent results now throw descriptive errors; parallel aggregation continues returning its explicit per-task summary.
- **Verification:** `subagent-extension-failure-semantics.test.ts` exercises the actual extension runner and asserts both canonical error classification and the missing-agent message.
- **Prevention/follow-up:** Use the declared tool-result contract and test `tool_execution_end`, not extra properties on direct executor return values.
- **Reusable learning:** A tool can signal execution failure only through the runtime's supported failure path; undeclared payload flags have no effect.
- **References:** `packages/coding-agent/examples/extensions/subagent/executor.ts`, `packages/coding-agent/test/suite/subagent-extension-failure-semantics.test.ts`
