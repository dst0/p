# 2026-08-20 — Benchmark archives and reports must preserve format and attribution semantics

- **Status:** Resolved
- **Task/context:** Review and finish a local benchmark evidence cleanup that
  removed large recordings, converted closed diagnostics, and extended report
  telemetry.
- **Unexpected observation or failure:** Eighteen recording deletions had no
  replacement archives, a Brotli stream was written with a `.gz` name, cache
  hit percentage omitted cache-write tokens, Codex results inherited the PI/P
  model alias, and persisted result documents exposed machine-specific paths.
- **Evidence:** Git status identified the unmatched recording deletions;
  decompression proved existing diagnostic replacements were Brotli; a focused
  report regression reproduced `50.0%` instead of `40.0%` for input/read/write
  usage of 40/40/20; and generated JSON contained absolute home, repository,
  and result paths.
- **Approaches tried:**
  - **Attempt:** Keep the deletions because the recordings were large, or put
    all restored streams into one compressed bundle.
    - **Outcome:** Rejected.
    - **Why:** The recording evidence would be lost or no longer independently
      addressable like the repository's other completed archives.
  - **Attempt:** Infer compression from the filename and compute cache hits
    from input plus cached reads only.
    - **Outcome:** Failed.
    - **Why:** The writer already emitted Brotli bytes, and cache writes are
      prompt tokens in the canonical denominator.
  - **Attempt:** Restore each source independently as Brotli Q6, extract report
    logic for focused tests, and sanitize result documents before persistence.
    - **Outcome:** Worked.
    - **Why:** Every archive remains independently readable, report semantics
      are regression-tested, and evidence is portable without changing runtime
      measurements.
- **Root cause:** The cleanup changed storage format and reporting fields
  without an explicit round-trip inventory or focused semantic tests, while
  agent-specific model attribution was incomplete.
- **Resolution:** Restored all 18 recordings as separate `.jsonl.br` Brotli Q6
  files, corrected the diagnostic extension, excluded volatile Kilo lock state,
  added cache-write-aware telemetry, recorded the independent Codex model alias,
  sanitized persisted paths, and reduced the legacy file-size baseline by
  extracting the report module.
- **Verification:** Each restored archive decompresses byte-for-byte to its Git
  source; report and sanitization regressions pass; regenerated reports and
  result JSON contain no absolute user paths; repository checks and the full
  unit/reinstall gates provide the final integration proof.
- **Prevention/follow-up:** Storage migrations must inventory every removed
  artifact and prove decoded equivalence one file at a time. Report formulas
  and agent/model attribution require focused fixtures before regenerating
  historical evidence.
- **Reusable learning:** A smaller archive is not a valid migration until its
  decoded bytes, per-artifact boundaries, filename format, and downstream
  report semantics are all proven.
- **References:** `scripts/benchmark-agents.js`,
  `scripts/benchmark-report.js`,
  `scripts/benchmark-result-sanitization.js`,
  `scripts/benchmark-runtime-evidence.js`,
  `scripts/benchmark-report.test.js`,
  `scripts/benchmark-result-sanitization.test.js`,
  `packages/coding-agent/docs/benchmarking.md`
