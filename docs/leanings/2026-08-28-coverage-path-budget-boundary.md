# 2026-08-28 — Prompt-budget boundary tests must avoid filesystem-length cliffs

- **Status:** Resolved
- **Task/context:** Stabilized the project-instruction processor regression that proves a compiled body falls back when no complete prompt-budget room remains for routed metadata.
- **Unexpected observation or failure:** The test passed locally but failed in CI because the generated compiled prompt was exactly at the hard limit on the CI path and exceeded it on the macOS `/private/var` temporary path.
- **Evidence:** CI received `mode: "compiled"`; local reproduction showed the compiled body plus the maximum route reserve was at the 4,996-character boundary, while the canonical macOS temporary path added enough fallback-guidance characters to cross it.
- **Approaches tried:**
  - **Attempt:** Accept either `compiled` or `fallback` in the assertion.
    - **Outcome:** Rejected.
    - **Why:** That would stop proving the intended fail-closed budget behavior.
  - **Attempt:** Add deterministic body margin while retaining the same semantic boundary scenario.
    - **Outcome:** Worked.
    - **Why:** The compiled candidate now exceeds the complete budget on every supported temporary-path length without changing production limits.
- **Root cause:** The test fixture placed a valid compiler result on a filesystem-dependent prompt-length cliff; fallback guidance contains the cache path, so canonical temporary-directory spelling changed the outcome.
- **Resolution:** Increased the fixture's global always-on source by a small bounded margin, keeping the body below the compiler body limit while making the fallback assertion path-independent.
- **Verification:** The focused processor suite passed locally with `CODEX_CI=1`; the follow-up CI run is required to certify the cross-platform boundary.
- **Prevention/follow-up:** Keep budget-boundary tests comfortably away from path-length-dependent margins, and reserve exact-limit assertions for code that controls every injected character.
- **Reusable learning:** A prompt-size test is only deterministic when fixture content dominates variable path metadata; otherwise platform path canonicalization can flip a legitimate boundary result.
- **References:** `packages/coding-agent/test/project-instructions-processor.test.ts`.
