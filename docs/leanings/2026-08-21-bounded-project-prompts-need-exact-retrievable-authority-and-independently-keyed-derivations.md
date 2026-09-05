# 2026-08-21 — Bounded project prompts need exact retrievable authority and independently keyed derivations

- **Status:** Resolved
- **Task/context:** Replace positional AGENTS/CLAUDE prompt truncation with a
  hash-driven processor, bounded injected block, and separate rule and skill
  readers.
- **Unexpected observation or failure:** The old 6,000-character keyword scan
  retained only 36 of 257 nonblank repository instruction lines and dropped
  every rule from the version-bump section onward. An initial replacement also
  called the model for small exact files, permanently cached failed
  compilations, recompiled when only skills changed, trusted cache-declared
  skill roots, and could corrupt a surrogate pair at a module boundary.
- **Evidence:** Direct system-prompt measurement showed an approximately
  37,000-character prompt and the exact 36/257 retained-line result. Focused
  adversarial reproductions exercised a forged self-consistent manifest with
  `baseDir` changed to `/`, two same-result cold-start processes, mixed-input
  live sessions, a 24,000-byte Unicode boundary, no-auth then working-compiler
  recovery, oversized resources, and a catalog larger than 512,000 bytes.
  The first installed local-model compile also ended with sanitized evidence
  `SyntaxError: Unexpected end of JSON input` while emitting every module
  trigger.
- **Approaches tried:**
  - **Attempt:** Keep a positional keyword excerpt under a fixed limit.
    - **Outcome:** Did not work
    - **Why:** Source order, not rule importance, decided which authoritative
      constraints disappeared.
  - **Attempt:** Store only a model-generated summary and treat extracted rules
    as ordinary skills.
    - **Outcome:** Rejected
    - **Why:** A summary is lossy authority, and skill discovery semantics do
      not express mandatory repository instructions.
  - **Attempt:** Hash the combined AGENTS and skill input and compile on every
    miss.
    - **Outcome:** Did not work
    - **Why:** It disclosed small files unnecessarily and resent unchanged
      instructions whenever an unrelated skill changed.
  - **Attempt:** Keep exact rule modules, key the model derivation only by the
    AGENTS chain, and build the skill catalog deterministically.
    - **Outcome:** Worked
    - **Why:** Exact authority stays locally retrievable, small inputs avoid the
      provider, and skill-only changes do not invalidate model work.
- **Root cause:** Prompt budgeting, authoritative storage, model derivation,
  skill discovery, and cache authority were treated as one lossy prompt-format
  operation instead of separate identities and trust boundaries.
- **Resolution:** Measure exact injection first; for overflow, preserve every
  UTF-8-safe exact module and inject only bounded routing. Cache successful
  compiler output by AGENTS hash, retry failures, paginate catalogs, pin live
  sessions to immutable versions, preflight read sizes, provide an ordinary-read
  fallback guide, and deep-compare cached source/module/canonical-skill records
  with fresh discovery before trusting paths. Record failed compiler attempts
  by model identity with a bounded backoff so fallback remains recoverable
  without repeating a slow failure on every startup. Keep model trigger
  overrides optional because deterministic heading triggers already provide a
  complete fallback; this leaves the model's bounded output budget for the
  optimized routing body.
- **Verification:** Six focused suites pass 33 tests, including cross-process,
  tamper, recovery, Unicode, pagination, allowlist, and size-limit regressions.
  The complete non-E2E gate passes 262 Vitest files and 2,274 tests, with all
  Node and Python segments at zero failures; `npm run check` and
  `./reinstall.sh` pass. A live first compile produced a 4,929-character block,
  reconstructed all three sources exactly, and a cached second startup reached
  the TUI in under five seconds; `read_rules` retrieved the late Version Bump
  module and completed with `V3_READ_RULES_OK`.
- **Prevention/follow-up:** Preserve the strict whole-block budget and add a
  regression for every new cache identity, retrieval route, or provider
  failure transition. Never let a mutable global pointer invalidate an already
  prepared session or let cached metadata define filesystem authority.
- **Reusable learning:** Separate source authority, model-derived routing, and
  deterministic catalogs by the narrowest relevant hash; bound only the
  injected representation, never the retrievable authoritative content.
- **References:** `packages/coding-agent/src/core/project-instructions/`,
  `packages/coding-agent/test/project-instructions-cache-integrity.test.ts`,
  `packages/coding-agent/test/project-instructions-recovery.test.ts`,
  `packages/coding-agent/docs/project-instructions.md`.
