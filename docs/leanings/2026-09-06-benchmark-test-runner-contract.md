# 2026-09-06 — Run new tests through their owning suite

- **Status:** Resolved
- **Task/context:** Private benchmark profile budget defaults.
- **Unexpected observation or failure:** A new benchmark test passed under Vitest but failed under the repository's Node test runner.
- **Evidence:** The focused aggregate produced ten successes and a failed file; the file imported Vitest while `test:benchmarks` uses `node --test`.
- **Approaches tried:**
  - **Attempt:** Reuse the coding-agent test runner for a benchmark test.
    - **Outcome:** Did not work
    - **Why:** The owning parent suite uses a different runtime contract.
- **Root cause:** Validation selected a familiar runner rather than the package's configured runner.
- **Resolution:** Use Node test/assert imports and rerun the owning focused benchmark command.
- **Verification:** All eleven focused benchmark cases pass under Node.
- **Prevention/follow-up:** Full `test:benchmarks` remains part of canonical unit validation.
- **Reusable learning:** A focused pass is valid only when it uses the owning suite's runner and module resolution.
- **References:** `package.json`, `benchmarks/test/workloads/benchmark-budget-choice.test.ts`.
