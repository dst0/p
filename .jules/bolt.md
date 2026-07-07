## 2026-06-30 - Regex inside tight loops in JS is slow
**Learning:** Checking for boundary characters inside a tight string-matching loop is significantly slower when using `RegExp.test()` compared to explicitly checking for individual characters via `===` or `!==`. Additionally, allocating `.toLowerCase()` results repeatedly in a loop is an unnecessary performance penalty when strings can be pre-lowercased before entering the iteration scope.
**Action:** Always prefer direct string comparison for simple character classes in high-frequency loops instead of using a generic regex test. Consider hoisting string allocations or normalization steps outside of heavy iterative processes.

## 2026-07-07 - Refactoring .toLowerCase() in loops and RegExp.test() in string matching
**Learning:** Checking character boundaries with `RegExp.test()` in tight string matching loops is slower than explicitly checking characters with `===`. Calling `.toLowerCase()` inside a loop for string comparisons incurs an unnecessary penalty compared to hoisting the allocations before entering iteration scopes.
**Action:** When working on string matching in high frequency functions, always compare single characters explicitly and hoist pre-allocated lowercased strings outside iterative scopes such as `.filter()` or `.map()`.
