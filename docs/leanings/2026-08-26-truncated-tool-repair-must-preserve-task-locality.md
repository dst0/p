# 2026-08-26 — Truncated tool repair must preserve task locality

- **Status:** Resolved
- **Task/context:** Investigating the long recovery after an oversized new-test-file write in rc.41 task 3.
- **Unexpected observation or failure:** The provider stopped a large write call at its output limit. The runtime correctly skipped execution, but its generic repair prompt caused the next turn to restart project discovery instead of retrying the one pending step in smaller units.
- **Evidence:** The partial call had `stopReason: length`, a parsed `write` identity, 8,668 content bytes, and no parsed path; existing loop ordering detected malformed output before tool execution. The following repair message contained no tool or target context and only requested a valid re-emission.
- **Approaches tried:**
  - **Attempt:** Add a final-line parameter, reconstruct partial JSON, or increase the provider output limit.
    - **Outcome:** Did not work
    - **Why:** None addresses pre-validation truncation; reconstruction risks executing semantically incomplete source, and any larger limit remains finite.
  - **Attempt:** Add bounded tool/path context without content, state that no execution occurred, and require retrying only the pending step with smaller calls.
    - **Outcome:** Worked
    - **Why:** The repair retains task locality without exposing the partial payload or weakening fail-closed execution.
- **Root cause:** Protocol recovery preserved safety but discarded the local operation context that the model needed to continue efficiently.
- **Resolution:** Malformed-call recovery now includes the sanitized capped tool label and includes the path only when it was parsed before truncation. It says the call was not executed, preserves already-known constraints, and directs bounded retries. Write guidance also requires responsibility-based file splits or compact writes followed by precise edits.
- **Verification:** Focused regressions cover both shapes: the observed path-missing call retains only the pending write identity, while a parsed-path call retains the write/path. Both contain locality guidance and never echo partial content; an agent-loop integration proves zero partial execution, one smaller retry, and completion.
- **Prevention/follow-up:** Keep tool-specific strategy in coding-agent tool metadata and generic sanitized recovery in the agent core.
- **Reusable learning:** Fail-closed recovery must preserve the identity of the pending step without replaying its payload; otherwise a safe retry can still waste the task budget through rediscovery.
- **References:** `packages/agent/src/agent-loop/tool-result-formatting.ts`, `packages/agent/test/tool-result-formatting-recovery.test.ts`, `packages/coding-agent/src/core/tools/write.ts`
