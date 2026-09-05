# 2026-09-05 — Shell output sanitization should reuse a compiled regex

- **Status:** Resolved
- **Task/context:** PR #108 changes `packages/agent/src/harness/utils/shell-output.ts`, where `sanitizeBinaryOutput` runs for every captured stdout and stderr chunk.
- **Unexpected observation or failure:** The previous implementation materialized `Array.from(str)`, invoked a predicate for every character, and joined a new array for each chunk. That creates avoidable intermediate allocations in a hot output path.
- **Evidence:** The previous predicate preserved U+0009, U+000A, and U+000D, removed U+0000–U+0008, U+000B–U+000C, U+000E–U+001F, and removed U+FFF9–U+FFFB. `SANITIZE_BINARY_REGEX` encodes those same ranges. Existing tests cover printable text, preserved whitespace, representative control characters, the U+FFF9/U+FFFB boundaries, and a surrogate pair. The focused Vitest run passed 21/21 tests. No numeric speedup claim is recorded here because this change was not accompanied by a reproducible benchmark.
- **Approaches tried:**
  - **Keep `Array.from(str).filter(...).join("")`:** Did not work for the hot path because it retains the per-character callback and intermediate array allocations.
  - **Use a regex literal inside the function:** Partial because it removes the array pipeline, but it does not make reuse of the sanitization pattern explicit at module scope.
  - **Use a module-level regex with `String.replace`:** Worked because the exclusion ranges remain visible in one reusable pattern and the per-chunk array allocation is removed.
- **Root cause:** Sanitization was implemented as an array transformation even though the operation is a fixed character-class replacement.
- **Resolution:** Keep the exclusion pattern at module scope and sanitize with `str.replace(SANITIZE_BINARY_REGEX, "")`.
- **Verification:** `node ../../node_modules/vitest/dist/cli.js --run test/harness/shell-output.test.ts --reporter=tap --no-color --bail=1` from `packages/agent` passed all 21 tests.
- **Prevention/follow-up:** Preserve tests for both removed-range boundaries and allowed tab/newline/carriage-return characters when changing the pattern. Add a repeatable benchmark before publishing any quantitative performance claim.
- **Reusable learning:** For fixed character filtering in a high-frequency string path, translate the exact predicate ranges into a module-level regular expression and retain boundary-focused behavior tests.
- **References:** [PR #108](https://github.com/dst0/p/pull/108), `packages/agent/src/harness/utils/shell-output.ts`, `packages/agent/test/harness/shell-output.test.ts`.
