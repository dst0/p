# 2026-09-03 — Action routing must separate syntax from operands

- **Status:** Resolved
- **Task/context:** Full-suite validation of compiled project-instruction routing before the rc.78 paired benchmark.
- **Unexpected observation or failure:** A `git commit` action selected generic Commands, delivery, and version modules while omitting the authoritative Git module.
- **Evidence:** The production routing regression selected `Universal Delivery Baseline (v1)`, `Commands`, and `Version Bump`; the same rules ranked `Git` first when queried with only the structural command `git commit`.
- **Approaches tried:**
  - **Attempt:** Use the complete shell command as the primary routing query.
    - **Outcome:** Did not work
    - **Why:** Commit messages, package names, and file operands can contain unrelated routing vocabulary and hijack the three-link budget.
  - **Attempt:** Use executable plus syntax-defined subcommand or script as the primary identity and retain the complete action only for secondary routing.
    - **Outcome:** Worked
    - **Why:** The structural identity preserves the action domain while excluding arbitrary operand text; existing contextual and chunk-boundary routing still contributes secondary modules.
- **Root cause:** Synthesized phase and semantic terms received normal routing weight together with serialized operands, so generic title matches could outrank the command's exact domain rule.
- **Resolution:** Parse bounded shell action identities through assignment, `command`, `env`, split-string, and shell wrappers; skip Git global option values; route the identity first, then merge turn candidates and every distinct full-action route.
- **Verification:** Production, hostile-operand, wrapped Git, package-install, deletion, late-chunk, and boundary-spanning routing regressions pass in the focused project-instruction suite.
- **Prevention/follow-up:** Keep action syntax and operands as separate ranking signals. Add hostile vocabulary to routing tests whenever a new command family is recognized.
- **Reusable learning:** Route control-plane intent from parsed command structure; use free-form operands only as lower-priority context.
- **References:** `packages/coding-agent/src/core/agent-session/project-instruction-action-routing.ts`, `packages/coding-agent/src/core/task-verification/git-command-classification.ts`, `packages/coding-agent/test/project-instruction-production-routing-liveness.test.ts`
