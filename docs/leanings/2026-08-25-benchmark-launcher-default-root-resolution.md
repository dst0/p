# 2026-08-25 — Benchmark launcher default root resolution

- **Status:** Resolved
- **Task/context:** Launching the paired project-instruction benchmark CLI entrypoint in `benchmarks/src/run-project-instructions.ts`.
- **Unexpected observation or failure:** Running the benchmark CLI entrypoint failed pre-provider during initialization with `Error: P must be built before benchmarking`, despite `packages/coding-agent/dist/cli.js` existing and being built.
- **Evidence:** The initial build check verified `pathExists(join(root, codingAgentCli))`. When invoked without an explicit `root` argument, `root` defaulted to `repoRoot`, which evaluated to `/repo/benchmarks` instead of `/repo`. Consequently, `pathExists` checked `/repo/benchmarks/packages/coding-agent/dist/cli.js`, which does not exist.
- **Approaches tried:**
  - **Attempt:** Rely on caller-supplied `root` parameters in test suites.
    - **Outcome:** Did not work
    - **Why:** Masked the real CLI entrypoint bug because test callers passed temporary directories or custom root paths, leaving the default `repoRoot` derivation unexercised.
  - **Attempt:** Correct default `repoRoot` to traverse two directory levels up (`resolve(dirname(scriptPath), "..", "..")`) from `benchmarks/src/run-project-instructions.ts` to the repository root, and verify with a regression test that omits the `root` override.
    - **Outcome:** Worked
    - **Why:** The default `root` correctly resolves to the repository root, allowing the benchmark launcher to locate `packages/coding-agent/dist/cli.js` and `AGENTS.md` without requiring explicit root overrides.
- **Root cause:** PR #103 relocated the executable entrypoint from `scripts/run-project-instructions.js` to `benchmarks/src/run-project-instructions.ts`. The `repoRoot` calculation `resolve(dirname(scriptPath), "..")` was not updated to traverse the additional directory depth, resolving to `benchmarks/` rather than the repository root.
- **Resolution:** Updated `repoRoot` in `benchmarks/src/run-project-instructions.ts` to `resolve(dirname(scriptPath), "..", "..")`. Added a focused regression test in `benchmarks/test/harness/candidate-integration.test.ts` verifying that `runProjectInstructionsBenchmark` without a `root` override inspects `packages/coding-agent/dist/cli.js` at the repository root.
- **Verification:** Verified failure in `benchmarks/test/harness/candidate-integration.test.ts` before the fix (`/Users/dst/dev/p/benchmarks/packages/coding-agent/dist/cli.js` !== `/Users/dst/dev/p/packages/coding-agent/dist/cli.js`), verified pass after the fix (5/5 tests), verified `npm run test:benchmarks` (311/311 tests pass), and ran `git diff --check`.
- **Prevention/follow-up:** When moving executable scripts to subdirectories, always verify default root and asset path derivations with tests that invoke entrypoints without root overrides.
- **Reusable learning:** Entrypoint relocations within a repository structure must update directory traversal depth for default root calculations; tests should exercise default parameter paths without mock root overrides to prevent path resolution regressions.
- **References:** `benchmarks/src/run-project-instructions.ts`, `benchmarks/test/harness/candidate-integration.test.ts`, `.changes/project-instruction-benchmark-default-root.json`.
