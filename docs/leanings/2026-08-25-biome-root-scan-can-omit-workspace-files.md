# 2026-08-25 — Biome root scans can omit workspace files

- **Status:** Partial
- **Task/context:** Revalidating repository formatting and hygiene gates after dependency hydration and monorepo rebuilds.
- **Unexpected observation or failure:** Running `biome check .` from the repository root checked only 760 files and applied no fixes, silently omitting all 1,124 source files in `packages/coding-agent`. When `packages/coding-agent` was explicitly included in the check invocation, all 1,884 files were evaluated and nine previously committed TypeScript files were reformatted.
- **Evidence:** Running `biome check .` reports 760 files checked. Running `biome check packages/coding-agent` reports 1,124 files checked. The exact arithmetic (`760 + 1,124 = 1,884`) matches `biome check . packages/coding-agent` which reports 1,884 files. The nine reformatted files were all within `packages/coding-agent` (type/value import ordering, line wrapping, conditional indentation, parentheses around `satisfies`, and blank line cleanup). Re-running `biome check --write --error-on-warnings . packages/coding-agent` confirmed full idempotence (1,884 files checked, 0 fixes).
- **Approaches tried:**
  - **Attempt:** Rely on `biome check .` from the root directory to discover all monorepo package files.
    - **Outcome:** Did not work
    - **Why:** The default scan evaluated only 760 files and skipped the 1,124 files in `packages/coding-agent`, leaving stale formatting unaddressed.
  - **Attempt:** Explicitly pass `packages/coding-agent` alongside `.` in the root `check` script and add an automated regression test in `scripts/check-biome-scope.test.js`.
    - **Outcome:** Worked
    - **Why:** Explicit target scoping forces Biome to evaluate the entire 1,884-file inventory across the monorepo, and the test prevents accidental scope omission in `package.json`.
- **Root cause:** While the file-count arithmetic is proven (`760 + 1,124 = 1,884`), the underlying reason why Biome's directory traversal from `.` omits `packages/coding-agent` (such as interactions with workspace globs, nested ignore files, or daemon traversal behavior) remains unproven without an isolated upstream reproduction.
- **Resolution:** Updated the root `check` script in `package.json` to `biome check --write --error-on-warnings . packages/coding-agent` and added `scripts/check-biome-scope.test.js` to `test:scripts` to enforce explicit coverage.
- **Verification:** Ran `node --test scripts/check-biome-scope.test.js` to confirm test enforcement; ran `npm run check` to verify all 1,884 files are checked with no fixes needed; verified all `npm run test:scripts` pass.
- **Prevention/follow-up:** Monitor file-count telemetry in linters and formatters against expected monorepo source totals. Explicitly enumerate package roots in formatting scripts when root-relative traversals omit packages.
- **Reusable learning:** Formatters running from a monorepo root may silently skip subpackages during relative traversal; verify total evaluated file counts against the repository inventory and explicitly supply package targets when discrepancies occur.
- **References:** `biome.json`, `package.json`, `scripts/check-biome-scope.test.js`, `.changes/project-instruction-benchmark-default-root.json`.
