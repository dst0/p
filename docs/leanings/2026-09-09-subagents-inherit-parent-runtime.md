# 2026-09-09 — Subagents inherit parent runtime

- **Status:** Resolved
- **Task/context:** Keep delegated work comparable to its parent while allowing explicit agent-profile overrides.
- **Unexpected observation or failure:** A profile without `model` or `thinking` launched a child using unrelated CLI defaults rather than the parent's exact runtime settings. An argument-echo fixture could not prove that the real CLI selected those settings. The first real-CLI regression also ran inside the repository, inherited unrelated project instructions, requested a second faux response, and delayed failure until child termination.
- **Evidence:** The focused invocation regression initially had no runtime resolver and could not produce inherited `--model` and `--thinking` arguments. A later real `p` CLI regression with a faux provider observed the selected provider, model, and reasoning level inside the request. Running that regression in an isolated temporary cwd reduced it to the intended single request and completed successfully.
- **Approaches tried:**
  - **Attempt:** Rely on child CLI defaults.
    - **Outcome:** Did not work
    - **Why:** Defaults can differ by account, configuration, or process and break same-model evaluation.
  - **Attempt:** Resolve profile values over parent values, pass the result explicitly, and observe it inside a real provider request.
    - **Outcome:** Worked
    - **Why:** Omitted fields inherit deterministically while explicit profile values, including `thinking: off`, remain authoritative.
- **Root cause:** The example only forwarded profile-local settings and had no parent runtime fallback. The initial integration fixture also confused the runtime contract under test with repository-local instruction discovery by using the package directory as its cwd.
- **Resolution:** Subagent invocations now pass the parent provider/model and thinking level unless the profile overrides them; invalid thinking labels are ignored rather than sent to the CLI. The real CLI regression uses an isolated temporary cwd and removes it in a `finally` block.
- **Verification:** `subagent-extension.test.ts` covers resolution rules; `subagent-runner.test.ts` launches both an argument fixture and the real `p` CLI with a faux provider under a 90-second full-suite margin; `subagent-executor.test.ts` verifies propagation through single, parallel, and chain modes.
- **Prevention/follow-up:** Treat model and reasoning configuration as explicit delegated-task inputs. Isolate real CLI fixtures from repository discovery unless project instructions are the behavior under test, and always clean owned temporary state in `finally`.
- **Reusable learning:** Comparable agent delegation requires explicit runtime inheritance; process defaults and an ambient repository cwd are not stable identities.
- **References:** `packages/coding-agent/examples/extensions/subagent/runtime-settings.ts`, `packages/coding-agent/test/subagent-extension.test.ts`
