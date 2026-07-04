## 2026-06-30 - Regex inside tight loops in JS is slow
**Learning:** Checking for boundary characters inside a tight string-matching loop is significantly slower when using `RegExp.test()` compared to explicitly checking for individual characters via `===` or `!==`. Additionally, allocating `.toLowerCase()` results repeatedly in a loop is an unnecessary performance penalty when strings can be pre-lowercased before entering the iteration scope.
**Action:** Always prefer direct string comparison for simple character classes in high-frequency loops instead of using a generic regex test. Consider hoisting string allocations or normalization steps outside of heavy iterative processes.

## 2026-07-04 - Precomputing search terms outside loops
**Learning:** In `scoreRecallCandidate`, `query.trim().toLowerCase().split(/\s+/)` was being computed on every candidate being scored. Pre-computing `normalizedQuery` and `terms` outside the `filter`/`map` array functions avoids repetitive and unnecessary string splitting and lowercasing inside the loop. This results in faster candidate scoring for session recall.
**Action:** When mapping or filtering over arrays (like `RecallCandidate` array), check if any calculations (especially string manipulation or array splitting) only depend on variables outside the loop and can be hoisted out.
