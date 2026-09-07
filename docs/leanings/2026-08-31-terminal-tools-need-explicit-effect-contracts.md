# 2026-08-31 — Terminal tools need explicit effect contracts

- **Status:** Resolved
- **Task/context:** Live-proof the post-evidence unknown-effect gate on an installed compiled-instruction audit session through successful `finish_work`.
- **Unexpected observation or failure:** The audit passed 6/6 and issued a valid completion token, but `finish_work` was blocked as an undeclared unknown effect, leaving the otherwise completed run unable to terminate.
- **Evidence:** In live session `01a05581-1098-7c9f-a0e7-c7e8614827aa`, `finish_work` returned `Cannot run finish_work after completion evidence was recorded because the tool has no declared effect` while mutation revision remained 1, readiness was `completion_ready`, and audit status was `passed`. Both the agent-loop replacement finish tool and the coding-agent registry definition omitted `effect`, so the runtime supplied `default_unknown` before the task-verification resolver could apply its name fallback.
- **Approaches tried:**
  - **Attempt:** Exempt the `finish_work` name inside the unknown-effect gate.
    - **Outcome:** Did not use
    - **Why:** A downstream name exception would hide the missing producer contract and leave other effect inventories seeing the terminal tool as unknown.
  - **Attempt:** Declare `{ kind: "read", risk: "normal" }` on both finish-tool definitions.
    - **Outcome:** Worked in focused tests
    - **Why:** The tool reports its real effect at the source, survives the agent-loop replacement, remains verification-dormant, and still passes through the existing completion-token gate.
- **Root cause:** The agent loop replaces the coding-agent finish definition with a core finish tool. Neither definition declared an effect, and a resolved `default_unknown` context is intentionally more authoritative than the task-verification resolver's builtin-name fallback.
- **Resolution:** Both finish-tool producers now declare the same read-only normal-risk effect. Tests bind the effect metadata on each producer and pass the actual core finish-tool effect through the post-evidence controller path.
- **Verification:** Regression tests failed with `effect: undefined` and a blocked post-evidence finish, then passed in the agent and coding-agent finish/effect suites. The rebuilt installed agent reports `{ "kind": "read", "risk": "normal" }`. Resuming live session `01a05581-1098-7c9f-a0e7-c7e8614827aa` preserved its revision-1 completion certificate; the model called `finish_work` once, the tool succeeded, and the process exited without rerunning definition, verification, or audit work.
- **Prevention/follow-up:** Every controller-owned protocol tool must declare an explicit effect at every producer or replacement boundary. Test the runtime-selected tool, not only a name-only synthetic hook context.
- **Reusable learning:** A safe consumer fallback cannot repair effect metadata that an upstream resolver has already classified as explicitly unknown; terminal protocol tools must declare their effect at the source.
- **References:** `packages/agent/src/completion-protocol.ts`, `packages/coding-agent/src/core/tools/finish-work.ts`, `packages/coding-agent/test/task-verification-external-effect-receipts.test.ts`, live session `01a05581-1098-7c9f-a0e7-c7e8614827aa`
