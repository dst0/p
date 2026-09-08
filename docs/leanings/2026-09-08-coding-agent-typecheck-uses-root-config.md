# 2026-09-08 — Coding-agent typecheck uses the root config

- **Status:** Resolved
- **Task/context:** Run a targeted typecheck after changing coding-agent budget code.
- **Unexpected observation or failure:** Invoking `tsgo -p packages/coding-agent/tsconfig.json` failed because that config does not exist.
- **Evidence:** The compiler returned `TS5058`; repository config discovery showed a root `tsconfig.json` and a package-only `tsconfig.build.json`.
- **Approaches tried:**
  - **Attempt:** Assume every workspace package has its own no-emit config.
    - **Outcome:** Did not work
    - **Why:** The coding-agent source and tests participate in the root project config.
  - **Attempt:** Run `tsgo --noEmit -p tsconfig.json` from the repository root.
    - **Outcome:** Worked
    - **Why:** It matches the repository's canonical `npm run check` typecheck scope.
- **Root cause:** The package build config was mistaken for a package-local development typecheck config.
- **Resolution:** Use the root TypeScript config for coding-agent source and test diagnostics.
- **Verification:** The corrected no-emit command completed with exit code 0 after the test fixture was fixed.
- **Prevention/follow-up:** Discover checked-in `tsconfig` files before constructing package-scoped compiler commands.
- **Reusable learning:** In this monorepo, typecheck coding-agent tests through the root `tsconfig.json`; use its package build config only for build-specific validation.
- **References:** `tsconfig.json`, `packages/coding-agent/tsconfig.build.json`, `package.json`
