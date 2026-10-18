# 2026-10-18 — Quadratic line counting in code chunker

- **Status:** Partial
- **Task/context:** Optimize `packages/code-index/src/chunk.ts` symbol-based chunking.
- **Unexpected observation or failure:** Each symbol match counted preceding newlines by copying and splitting the entire source prefix, repeatedly.
- **Evidence:** `content.slice(0, match.index).split("\\n")` inside the matching loop. A standalone synthetic Node.js 22 benchmark at 10,000 declarations measured roughly 1,016 ms baseline versus 1.7 ms using a single forward scan; this is not an end-to-end indexing benchmark.
- **Approaches tried:**
  - **Attempt:** Incremental forward newline scan between successive match offsets.
    - **Outcome:** Worked on a standalone parity harness.
    - **Why:** The regex emits monotonically increasing match positions and newline counting only needs LF delimiters.
- **Root cause:** Repeated full-prefix allocations and rescanning cause approximately quadratic work in declaration-dense files.
- **Resolution:** Retain one monotonically advancing source offset and line counter while iterating declarations.
- **Verification:** Standalone Node 22 parity check on mixed line endings, Unicode, and files with 500–10,000 declarations. Repository's CI and complete indexing smoke checks remain outstanding.
- **Prevention/follow-up:** Regression tests for symbol offsets, 20,000 declarations, and indexing-version tracking. Run repository checks, reinstall, smoke tests and review CI before merge.
- **Reusable learning:** When converting ordered match offsets to line numbers, advance one shared scan cursor instead of recounting the prefix for every match.
- **References:** `packages/code-index/src/chunk.ts`; `packages/code-index/test/chunk-symbol-extraction.test.ts`.
