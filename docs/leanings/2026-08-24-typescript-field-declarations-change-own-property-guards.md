# 2026-08-24 — TypeScript field declarations change own-property guards

- **Status:** Resolved
- **Task/context:** Migrating the JavaScript benchmark interruption lifecycle to directly executed, strip-only TypeScript.
- **Unexpected observation or failure:** Cleanup failures stopped attaching to `BenchmarkInterruptedError` after its optional `cleanupErrors` field was declared for TypeScript.
- **Evidence:** The JavaScript implementation used absence of an own `cleanupErrors` property as its initialization condition. A public class-field declaration creates that own property with value `undefined`, so the condition no longer initialized the private non-enumerable array.
- **Approaches tried:**
  - **Attempt:** Preserve the JavaScript `Object.hasOwn` guard after adding the TypeScript field.
    - **Outcome:** Did not work
    - **Why:** The field declaration changed the runtime object shape even though its type annotation is erasable.
  - **Attempt:** Initialize whenever the current value is not an array.
    - **Outcome:** Worked
    - **Why:** The guard now expresses the required runtime invariant instead of relying on property absence.
- **Root cause:** A TypeScript class-field declaration is not purely a type annotation; direct Node execution initializes the field and invalidates JavaScript logic based on own-property absence.
- **Resolution:** `attachBenchmarkCleanupError` checks `Array.isArray(interruption.cleanupErrors)` before defining the private array.
- **Verification:** Focused interruption and process-finalization tests pass, including repeated cleanup attachment and signal-driven error preservation.
- **Prevention/follow-up:** During JavaScript-to-TypeScript migration, audit every added class field against `hasOwn`, enumeration, serialization, and descriptor-sensitive behavior.
- **Reusable learning:** Never assume adding a TypeScript class-field declaration is runtime-neutral; guard the value invariant directly when object shape matters.
- **References:** `benchmarks/src/harness/interruption.ts`, `benchmarks/test/harness/interruption-cleanup.test.ts`, `benchmarks/test/harness/process-interruption.test.ts`.
