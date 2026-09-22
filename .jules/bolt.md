## 2026-06-30 - Regex inside tight loops in JS is slow
**Learning:** Checking for boundary characters inside a tight string-matching loop is significantly slower when using `RegExp.test()` compared to explicitly checking for individual characters via `===` or `!==`. Additionally, allocating `.toLowerCase()` results repeatedly in a loop is an unnecessary performance penalty when strings can be pre-lowercased before entering the iteration scope.
**Action:** Always prefer direct string comparison for simple character classes in high-frequency loops instead of using a generic regex test. Consider hoisting string allocations or normalization steps outside of heavy iterative processes.
## 2026-06-30 - Combining array of Regexes is faster than .some(.test)
**Learning:** Iterating through an array of regular expressions and checking each one individually using `.some(regex => regex.test(string))` is significantly slower than combining those regular expressions into a single `RegExp` pattern using `.map(p => p.source).join('|')` and testing once. For an array of ~25 patterns, testing the combined regex is about 5x faster than testing them individually.
**Action:** When performing high-frequency pattern matching against a fixed set of fallback regular expressions, combine them into a single `RegExp` at module load time to maximize evaluation performance.
## 2026-07-13 - Replace mapping iteration with cached object for string similarity scores
**Learning:** Comparing lists of strings by performing similarity scores via sets of words (`scoreComparableText` utilizing `normalizeComparableText` and `comparableTerms`) incurs enormous repetitive computation cost because the algorithm has to split and normalize the same strings again and again during an O(N * M) comparison loop inside `removeSimilarProgressItems`. Adding a basic bounded `Map` cache (evicting if size > 2000) reduced the evaluation time for a mock payload from ~819ms to ~35ms, a 23x performance improvement in the tight iteration path.
**Action:** When evaluating diffs between lists by normalizing item formats repeatedly in an inner loop, cache the normalizations explicitly or hoist normalizations out into a pre-computed format.

## 2026-07-13 - Replace `.some` and `.findIndex` in tight loops with `for` loops
**Learning:** For a very tight loop executed frequently, allocating an inline callback function for `Array.prototype.some` or `Array.prototype.findIndex` introduces noticeable overhead. Refactoring them to a simple explicit `for` loop removes the overhead and speeds up the loop slightly.
**Action:** Avoid `.some()`, `.every()`, `.filter()`, and `.findIndex()` for large dataset O(N^2) intersection tests where the inner function does very little, preferring manual `for` loop construction.

## 2026-07-14 - Pre-calculate string normalization outside O(N*M) loops
**Learning:** Performing regex replacement or string normalization inside an O(N*M) loop (such as comparing a list of items against another list) creates massive overhead due to repeated execution of string operations and regex allocations on the same inputs.
**Action:** When filtering or comparing two lists, iterate over the lists once beforehand to pre-calculate and cache any normalized strings, tokens, or `Set` objects, so the inner `N*M` loop only does simple equality checks and math. Also, extract regexes to module-level constants to avoid instantiation on every function call.

## 2024-07-23 - Precompile Minimatch globs in hot paths to avoid recompilation
**Learning:** `minimatch(filePath, pattern)` creates a new RegExp every time. Inside a loop that processes many files against many patterns (like in `matchesAnyPattern` and `applyPatterns` for package managers), this is a significant bottleneck, causing O(N*P) regex compilations. The same applies for filtering large sets of models against a glob pattern.
**Action:** When matching against multiple items, ALWAYS use `new Minimatch(pattern)` before the loop and use `compiledMatcher.match(item)` inside the loop to avoid redundant regex recompilations.

## 2026-08-29 - Pre-compiled Regex is vastly faster than Array filtering for string sanitization
**Learning:** In hot paths processing large text outputs (like shell output chunks), using `Array.from(str).filter(...).join('')` creates massive memory allocations and performance degradation due to the creation of large intermediate arrays. A pre-compiled Regex `.replace()` avoids these allocations and runs orders of magnitude faster (~20x+ in tests).
**Action:** When sanitizing or filtering characters out of large strings in hot paths, use a pre-compiled Regex with `.replace()` rather than converting the string to an array for filtering.

## 2026-10-23 - Pre-compiled Regex checking is faster than expanding string to array and using .some()
**Learning:** Expanding a string into an array of characters (e.g., `[...str].some(...)`) to check for character sets or control characters is significantly slower (around 5-10x) than simply using a pre-compiled Regex like `/[...chars]/.test(str)`. The array allocation and iteration overhead is entirely unnecessary for simple pattern matching.
**Action:** When checking if a string contains specific characters or control codes, always use a pre-compiled `RegExp.test()` instead of splitting or expanding the string into an array and iterating over it.
## 2026-09-18 - Replacing chained array filters with explicit iteration
**Learning:** Performing multiple `.filter()` passes and array creations (like filtering based on include/exclude match rules) creates many intermediate arrays and iterators that degrade performance in hot paths processing large arrays (such as thousands of file paths).
**Action:** When filtering logic requires multiple sequential steps and states (e.g. includes, exclusions, force-includes), combine them into a single, explicit `for` loop that iterates once over the array and updates a boolean flag, pushing passing elements to a final result structure.
## 2024-05-18 - Pre-compiled regex avoids array allocations from .split('/')
**Learning:** Checking for boundary characters inside a tight string-matching loop (such as verifying file paths in `isSkippedWorkspaceEffectPath`) using `.split('/').some(...)` allocates an intermediate array and multiple substring instances on every path check. Using a single precompiled regex with bounded segments is cleaner and faster.
**Action:** Replace `.split('/').some(...)` boundary checks with a pre-compiled regex with `(?:\/|^)` and `(?:\/|$)` boundaries. Also, correctly escape regex literals (e.g., `.` or `?`) when building patterns dynamically from static strings using `str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")`.

## 2025-09-22 - [Refactoring redundant `filter` passes on Message arrays]
**Learning:** In code executing frequently or processing large data sets (such as agent session logs with thousands of messages), using chained `Array.prototype.filter()` calls to compute aggregate counts induces significant performance penalties. Each filter pass both iterates the entire array and allocates intermediate arrays that trigger aggressive garbage collection. In a typical `getSessionStats` pass, calculating message counts via filters ran in roughly ~450ms vs ~130ms for a unified `for...of` loop (a >3x overhead).
**Action:** Always combine sequential or repetitive mapping/filtering loops over core data structures like the agent session `messages` array into a single explicit loop to eliminate intermediary space overhead and reduce runtime iteration complexity (O(1) space, O(N) time).
