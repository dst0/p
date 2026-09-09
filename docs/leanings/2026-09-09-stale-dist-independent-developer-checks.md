# 2026-09-09 — Stale-dist independent developer checks

- **Status:** Resolved
- **Task/context:** Decouple source CLI execution (`p-test.sh` / `npm run dev`) and benchmark typechecking (`benchmarks/tsconfig.json`) from ignored stale `dist` directories.
- **Unexpected observation or failure:** Running `npm run dev -- --version` from outside the repository failed with `ERR_MODULE_NOT_FOUND` for `node_modules/@dst0/p-tui/dist/index.js` because `tsx` without an explicit `--tsconfig` resolved relative to caller cwd rather than the repo root tsconfig path mappings. Additionally, running `tsgo --noEmit -p benchmarks/tsconfig.json` failed with over 800 type errors in unbuilt worktrees because `benchmarks/tsconfig.json` extended `../tsconfig.base.json` (which lacks path aliases and rootDirs) and benchmark sources import from `dist/`.
- **Evidence:** Clean unbuilt worktrees without `dist/` reproduced both failures immediately: running `p-test.sh` from `/tmp` threw an unresolvable module error, and running `tsgo -p benchmarks/tsconfig.json` failed with `TS2307: Cannot find module` across benchmark suites.
- **Approaches tried:**
  - **Attempt:** Pass root tsconfig to tsx in `p-test.sh` and configure `rootDirs` mapping in `benchmarks/tsconfig.json`.
    - **Outcome:** Worked
    - **Why:** Passing `--tsconfig "$script_dir/tsconfig.json"` to `$tsx_bin` ensures `tsx` resolves TypeScript path mappings irrespective of current working directory. In TypeScript/tsgo, relative specifiers like `../../packages/coding-agent/dist/...` bypass `compilerOptions.paths`, but `rootDirs: ["..", "../packages/coding-agent/src", "../packages/coding-agent/dist"]` alongside extending `../tsconfig.json` instructs the compiler to treat `src` and `dist` as merged virtual directories, resolving dist imports directly to source files without requiring build artifacts.
- **Root cause:** `p-test.sh` invoked `$tsx_bin` without pinning `--tsconfig`, and `benchmarks/tsconfig.json` lacked rootDir virtualization for relative dist imports.
- **Resolution:** Updated `p-test.sh` to pass `--tsconfig "$script_dir/tsconfig.json"` and updated `benchmarks/tsconfig.json` to extend `../tsconfig.json` with `rootDirs` virtualization. Added regression tests in `scripts/p-test-wrapper.test.js`.
- **Verification:** Ran `npm run test:cli` (both tests passing), ran root typecheck `tsgo --noEmit`, and ran benchmark typecheck `tsgo --noEmit -p benchmarks/tsconfig.json` (all exit 0 with no dist built).
- **Prevention/follow-up:** CLI wrapper tests in `scripts/p-test-wrapper.test.js` gate outside-repo invocation and unbuilt benchmark typechecking.
- **Reusable learning:** In TypeScript monorepos where benchmark or test files reference `dist/` directories, relative imports do not match `paths` mappings; use `rootDirs` to virtualize source and dist paths together so typechecking succeeds in fresh, unbuilt checkouts.
- **References:** `p-test.sh`, `benchmarks/tsconfig.json`, `scripts/p-test-wrapper.test.js`
