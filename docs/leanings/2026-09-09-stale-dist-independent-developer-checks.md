# 2026-09-09 — Stale-dist independent developer checks

- **Status:** Corrected
- **Correction (2026-09-09):** The original entry overstated `rootDirs` as source-authoritative. A compiler resolution trace proved that an existing `dist/*.d.ts` wins before the virtual source fallback. The CLI wrapper fix remains valid, but benchmark stale-declaration independence required a later typed runtime binding; see `2026-09-09-benchmark-source-type-authority.md`.
- **Task/context:** Decouple source CLI execution (`p-test.sh` / `npm run dev`) and benchmark typechecking (`benchmarks/tsconfig.json`) from ignored stale `dist` directories.
- **Unexpected observation or failure:** Running `npm run dev -- --version` from outside the repository failed with `ERR_MODULE_NOT_FOUND` for `node_modules/@dst0/p-tui/dist/index.js` because `tsx` without an explicit `--tsconfig` resolved relative to caller cwd rather than the repo root tsconfig path mappings. Additionally, running `tsgo --noEmit -p benchmarks/tsconfig.json` failed with over 800 type errors in unbuilt worktrees because `benchmarks/tsconfig.json` extended `../tsconfig.base.json` (which lacks path aliases and rootDirs) and benchmark sources import from `dist/`.
- **Evidence:** Clean unbuilt worktrees without `dist/` reproduced both failures immediately: running `p-test.sh` from `/tmp` threw an unresolvable module error, and running `tsgo -p benchmarks/tsconfig.json` failed with `TS2307: Cannot find module` across benchmark suites.
- **Approaches tried:**
  - **Attempt:** Pass root tsconfig to tsx in `p-test.sh` and configure `rootDirs` mapping in `benchmarks/tsconfig.json`.
    - **Outcome:** Partial
    - **Why:** Passing `--tsconfig "$script_dir/tsconfig.json"` fixed source CLI resolution from external working directories. `rootDirs` made unbuilt checks work, but only as a fallback: when `dist/*.d.ts` exists, TypeScript resolves it first and can silently validate stale API declarations.
- **Root cause:** `p-test.sh` invoked `$tsx_bin` without pinning `--tsconfig`, while benchmark value imports intentionally targeted runtime `dist` and therefore also inherited `dist` declaration authority whenever those files existed.
- **Resolution:** Updated `p-test.sh` to pass the root tsconfig and retained `rootDirs` for the no-dist fallback. Source-authoritative benchmark typing was completed separately with a typed runtime binding that preserves immutable `dist` JavaScript execution.
- **Verification:** The original no-dist and outside-repository checks passed, but a later `tsgo --traceResolution` run disproved stale-dist independence by resolving `auth-storage.js` to `packages/coding-agent/dist/core/auth-storage.d.ts`.
- **Prevention/follow-up:** Keep the CLI regressions, and enforce that every benchmark runtime namespace import from `dist` has a paired type-only `src` import plus an explicit `runtime as unknown as typeof source` authority cast.
- **Reusable learning:** `rootDirs` virtualizes missing relative paths; it does not override a real declaration file found at the literal import path. Separate runtime artifact identity from source type authority explicitly.
- **References:** `p-test.sh`, `benchmarks/tsconfig.json`, `scripts/p-test-wrapper.test.js`, `benchmarks/src/project-instructions/coding-agent-runtime-bindings.ts`, `benchmarks/test/harness/coding-agent-source-declarations.test.ts`
