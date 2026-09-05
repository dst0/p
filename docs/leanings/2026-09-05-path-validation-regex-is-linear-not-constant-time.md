# 2026-09-05 — Path-validation regexes are linear, not constant-time

- **Status:** Resolved
- **Task/context:** PR #113 changes lexical path validation in `packages/coding-agent/src/core/project-instructions/cache.ts` and `reader.ts`.
- **Unexpected observation or failure:** Replacing `split(...).some(...)` removes the intermediate segment array, but describing `RegExp.prototype.test` as O(1) is incorrect. A path validator must inspect input characters, so its worst-case cost depends on path length.
- **Evidence:** The original split-based check and the replacement regex both have O(n) input-size behavior. The module-level regex avoids the split array while retaining rejection of empty segments, `.`/`..` segments, and both slash separators where applicable. Focused tests cover eight invalid catalog-link boundaries through both link readers and a traversal-like cache path (`rules/../prompt.md`); 22/22 project-instructions tests passed after the regressions were added.
- **Approaches tried:**
  - **Keep `split(...).some(...)`:** Worked semantically, but retained per-call array allocation and segment iteration.
  - **Describe the regex as O(1):** Did not work because constant-time behavior cannot hold for arbitrary path lengths.
  - **Use a module-level regex and document O(n) behavior:** Worked because it removes the intermediate array without overstating the complexity.
- **Root cause:** The optimization's allocation improvement was incorrectly conflated with constant-time complexity.
- **Resolution:** Keep the precompiled regex implementation, correct the guidance to O(n), and add explicit lexical boundary regressions.
- **Verification:** `node ../../node_modules/vitest/dist/cli.js --run test/project-instructions-processor.test.ts test/project-instructions-cache-integrity.test.ts --reporter=tap --no-color --bail=1` from `packages/coding-agent` passed all 22 tests.
- **Prevention/follow-up:** Review complexity claims separately from allocation claims. Keep tests for empty, dot, dot-dot, repeated-separator, mixed-separator, and normalization-like paths.
- **Reusable learning:** A regex can remove intermediate allocations while remaining linear in input length; describe the asymptotic cost of the scan, not just the allocation profile.
- **References:** [PR #113](https://github.com/dst0/p/pull/113), `packages/coding-agent/src/core/project-instructions/cache.ts`, `packages/coding-agent/src/core/project-instructions/reader.ts`, `packages/coding-agent/test/project-instructions-processor.test.ts`, `packages/coding-agent/test/project-instructions-cache-integrity.test.ts`.
