# 2026-08-21 — Built-in tools must be discoverable through CLI help

- **Status:** Resolved
- **Task/context:** Installed-CLI smoke verification for the new `read_rules` and `read_skills` tools.
- **Unexpected observation or failure:** Both readers were active in sessions and accepted by `--tools`, but `p --help` omitted their names from the built-in tool catalog.
- **Evidence:** The installed help output ended with the legacy built-ins while the session integration suite reported both readers active; a focused help regression failed on both missing names before the fix.
- **Approaches tried:**
  - **Attempt:** Treat the system-prompt routing text as sufficient discoverability.
    - **Outcome:** Did not work
    - **Why:** Users constructing an explicit `--tools` allowlist need the exact accepted names before a session starts.
  - **Attempt:** Add both names and concise capability descriptions to the canonical CLI help output.
    - **Outcome:** Worked
    - **Why:** The installed command contract now matches the runtime tool registry.
- **Root cause:** Tool registration and help text are maintained through separate paths, and the feature initially updated only runtime registration.
- **Resolution:** `p --help` now advertises `read_rules` and `read_skills` beside the other built-ins.
- **Verification:** `cli-help-project-instruction-tools.test.ts` fails before the help update and passes after it; the installed help will be rechecked after relinking.
- **Prevention/follow-up:** Every new built-in tool must add a CLI-help contract assertion alongside runtime registration tests.
- **Reusable learning:** A callable feature is not fully installed if users cannot discover its exact allowlist name from the product's canonical help surface.
- **References:** `packages/coding-agent/test/cli-help-project-instruction-tools.test.ts`, `packages/coding-agent/src/cli/args.ts`.
