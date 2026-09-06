# 2026-09-06 — Lazy path matching defers each representation

- **Status:** Resolved
- **Task/context:** PR #111 optimizes `matchesAnyPattern()` in the coding-agent package manager.
- **Unexpected observation or failure:** The initial patch cached variables, but still derived the relative path, basename, normalized absolute path, and all skill-parent forms before the first `match()`. An early relative-path match therefore paid the same unnecessary path-derivation cost.
- **Evidence:** The regression test failed on the initial PR head because a relative match still called `basename()`. A parent-directory match also showed that parent representations were computed before their individual match attempts.
- **Approaches tried:**
  - **Attempt:** Cache all path representations after entering the pattern loop.
    - **Outcome:** Partial.
    - **Why:** It avoided repeated work across patterns and handled an empty pattern list, but did not defer later representations after an early match.
  - **Attempt:** Derive each representation immediately before its corresponding `match()` call.
    - **Outcome:** Worked.
    - **Why:** Relative, basename, absolute, and skill-parent paths are now computed only when earlier forms did not match.
- **Root cause:** Lazy state was introduced at the loop level rather than at each ordered match boundary.
- **Resolution:** Keep each derived path in a cache, but populate it with `??=` directly before its own match and preserve the existing relative, basename, absolute, and skill-parent matching order.
- **Verification:** `test/binary-resolution.test.ts` passes 15/15, covering no-pattern, relative, basename, absolute, all three skill-parent forms, and positive and negative exact matches. The existing `test/package-manager.test.ts -t "pattern filtering"` passes 21/21, and `npm run check` passes.
- **Prevention/follow-up:** Keep the short-circuit call-count regressions with the path-matching tests when changing this hot path.
- **Reusable learning:** Caching a value is not sufficient for lazy evaluation; place each cache fill after all earlier short-circuit branches that can make it unnecessary.
- **References:** PR [#111](https://github.com/dst0/p/pull/111); `packages/coding-agent/src/core/package-manager/binary-resolution.ts`; `packages/coding-agent/test/binary-resolution.test.ts`.
