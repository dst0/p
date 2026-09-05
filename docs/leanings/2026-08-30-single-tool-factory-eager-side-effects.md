# 2026-08-30 — Single-tool factory eager side effects

- **Status:** Resolved
- **Task/context:** Register `generate_image` with the coding-agent built-in tool factories while preserving single-tool construction behavior.
- **Unexpected observation or failure:** The full unit suite failed when `createToolDefinition("rg", "/test")` attempted to initialize semantic search and resolve the unrelated `/test` workspace.
- **Evidence:** The stack trace entered `WorkspaceCodeRagService` from `createAllToolDefinitions()` even though the requested tool was `rg`; the focused regression passed after restoring named lazy construction.
- **Approaches tried:**
  - **Attempt:** Implement single-tool lookup by constructing the full tool record and selecting one entry.
    - **Outcome:** Failed.
    - **Why:** Tool construction has observable filesystem and service side effects, so eager creation changes behavior and can fail on dependencies irrelevant to the requested tool.
  - **Attempt:** Keep aggregate factories for full sessions and add exhaustive named factories for single-tool callers.
    - **Outcome:** Worked.
    - **Why:** Each path creates exactly the tools its caller requested while the `ToolName` switch remains compiler-checked.
- **Root cause:** A refactor treated tool factories as pure value constructors even though semantic search initializes workspace-bound runtime state.
- **Resolution:** Added lazy `createNamedToolDefinition()` and `createNamedTool()` dispatchers and routed the public single-tool helpers through them.
- **Verification:** `tools-find-grep-ops.test.ts` and `3592-no-builtin-tools-keeps-extension-tools.test.ts` pass together; the full suite verifies aggregate registration separately.
- **Prevention/follow-up:** Do not implement targeted factory lookup by eagerly building registries whose entries initialize I/O, services, or workspace state.
- **Reusable learning:** A record of factories is safe to index eagerly; a record of constructed runtime objects may not be.
- **References:** `packages/coding-agent/src/core/tools/index.ts`, `packages/coding-agent/src/core/tools/tool-factories.ts`, `packages/coding-agent/test/tools-find-grep-ops.test.ts`
