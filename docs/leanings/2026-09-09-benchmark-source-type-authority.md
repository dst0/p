# 2026-09-09 — Benchmark runtime and type authority must be separate

- **Status:** Resolved
- **Task/context:** Make benchmark typechecks validate current coding-agent source APIs while the certified runtime continues to execute the immutable built `dist` snapshot.
- **Unexpected observation or failure:** `rootDirs` only redirected missing `dist` imports. In a built checkout, TypeScript resolved literal `dist/*.js` imports to the existing `dist/*.d.ts`, so stale declarations could make release checks validate an old API.
- **Evidence:** `tsgo --traceResolution -p benchmarks/tsconfig.json` resolved `auth-storage.js` to `packages/coding-agent/dist/core/auth-storage.d.ts`. A regression that replaced every coding-agent runtime declaration with `export {};` failed on 24 direct named imports across four benchmark files, while the ordinary typecheck still passed.
- **Approaches tried:**
  - **Attempt:** Replace benchmark runtime imports with direct `src/*.ts` imports.
    - **Outcome:** Rejected
    - **Why:** The seed helper runs under bare Node inside an immutable runtime snapshot that intentionally copies package `dist`; snapshot closure validation rejects source-package value imports.
  - **Attempt:** Route all coding-agent runtime values through one binding module that namespace-imports `dist` at runtime, imports the corresponding source modules type-only, casts through `unknown`, and re-exports source-typed values.
    - **Outcome:** Worked
    - **Why:** Snapshot execution still loads the exact built JavaScript, while consumer typechecking no longer depends on the runtime declaration surface.
- **Root cause:** One literal import path was incorrectly serving two authorities: runtime artifact selection and compile-time API truth.
- **Resolution:** Added `coding-agent-runtime-bindings.ts`, routed the four benchmark consumers through it, retained `rootDirs` only for missing-dist fallback, and added binding-contract and script-suite-enumeration regressions.
- **Verification:** Adversarially replacing every coding-agent `dist/*.d.ts` with an empty module confirmed that the binding compiles against source authority. The final fast regression scans every benchmark import and requires each binding runtime namespace to have a paired type-only source namespace plus the explicit authority cast. `npm run test:cli` passed all three checks and is now included by `test:scripts`.
- **Prevention/follow-up:** Keep direct coding-agent `dist` imports confined to the binding module and require a matching type-only source import for every runtime module added there.
- **Reusable learning:** When a certified tool must execute built artifacts but developers must typecheck current source, make runtime identity and type authority explicit and independently test both.
- **References:** `benchmarks/src/project-instructions/coding-agent-runtime-bindings.ts`, `benchmarks/test/harness/coding-agent-source-declarations.test.ts`, `scripts/p-test-wrapper.test.js`, `package.json`, `docs/leanings/2026-09-09-stale-dist-independent-developer-checks.md`
