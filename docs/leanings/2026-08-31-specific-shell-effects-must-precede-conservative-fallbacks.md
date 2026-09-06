# 2026-08-31 — Specific shell effects must precede conservative fallbacks

- **Status:** Resolved
- **Task/context:** Making semantic requirement audit explicit opt-in while preserving evidence-mode verification gates in the coding agent.
- **Unexpected observation or failure:** A recognized test command was blocked as a fourth test-file mutation after the three-path authoring budget was full.
- **Evidence:** The task-verification resolver classified `npm test` as a built-in `workspace_write` effect before applying test-command semantics. For intentionally conservative compound invocations such as `npm test | head`, the test-authoring path extractor also interpreted the literal npm subcommand `test` as a path named `test`.
- **Approaches tried:**
  - **Attempt:** Keep the general shell mutation classifier authoritative for every shell command.
    - **Outcome:** Did not work
    - **Why:** Its intentionally conservative fallback ran before the narrower test-command recognizer and erased the more specific read-evidence meaning.
  - **Attempt:** Resolve a structurally focused test invocation before applying the conservative workspace-mutation fallback.
    - **Outcome:** Worked
    - **Why:** Exact test invocations become read evidence, while arbitrary, mutating, redirected, and multi-command shell input still falls through to conservative classification.
- **Root cause:** Effect resolution evaluated a broad conservative predicate before a narrower domain-specific predicate. The resolver order made valid verification commands indistinguishable from possible workspace mutations.
- **Resolution:** Task-verification effect resolution now recognizes focused test invocations first and preserves any valid supplied effect provenance. All other shell commands retain conservative handling, while the test-authoring path extractor excludes only a recognized invocation's literal `test` subcommand from candidate file paths.
- **Verification:** The four previously failing test-authoring gate regressions pass, including successful, failed, masked, vacuous, unrelated, and selector-mismatch verification outcomes. Audit-focused requirement tests, Biome, and TypeScript checks cover the surrounding change.
- **Prevention/follow-up:** Keep effect resolvers ordered from explicit supplied metadata, through narrow domain-specific recognition, to conservative fallback. Maintain regressions proving compound or mutating shell commands cannot use the test-evidence path.
- **Reusable learning:** When predicates overlap, resolve trustworthy narrow semantics before a conservative fallback; do not loosen the fallback to repair an ordering bug.
- **References:** `packages/coding-agent/src/core/task-verification/taskverificationcontroller-methods/tool-effect-resolution.ts`, `packages/coding-agent/test/task-verification-test-authoring-gate.test.ts`
