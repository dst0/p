# 2026-08-30 — Built-in tool help registration

- **Status:** Resolved
- **Task/context:** Smoke-test the installed `generate_image` tool and `/model:image` workflow.
- **Unexpected observation or failure:** The installed CLI accepted `generate_image` as a built-in tool, but `p --help` omitted it from the documented `--tools` names.
- **Evidence:** The installed help output listed the older built-ins only; the help regression failed until the new tool name and description were added.
- **Approaches tried:**
  - **Attempt:** Rely on the runtime tool registry as sufficient discoverability.
    - **Outcome:** Rejected.
    - **Why:** Users configure tool allowlists from the CLI contract, and the help text is the local authoritative list for that flag.
  - **Attempt:** Extend the existing built-in help regression with the image tool name.
    - **Outcome:** Worked.
    - **Why:** The test now binds registration and documented CLI discoverability.
- **Root cause:** Built-in registration and CLI help are maintained on separate surfaces, and the feature changed only the runtime registry.
- **Resolution:** Added `generate_image` to the built-in tool help and covered it alongside the existing project instruction tools.
- **Verification:** `cli-help-project-instruction-tools.test.ts` and installed `p --help` verify the tool name is advertised.
- **Prevention/follow-up:** Every new built-in tool must update both runtime registration and the CLI `--tools` help contract.
- **Reusable learning:** A callable feature is not fully integrated when the configuration surface cannot discover its canonical name.
- **References:** `packages/coding-agent/src/cli/args.ts`, `packages/coding-agent/test/cli-help-project-instruction-tools.test.ts`
