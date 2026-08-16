# Vitest v1–v3 Legacy Compatibility & Migration

When working with codebases pinned to older Vitest releases (v1.x through v3.x), specific configuration and API discrepancies must be handled.

---

## 1. Major Differences Across Vitest Generations

| Feature / Behavior | Vitest v1.x–v3.x | Vitest v4+ |
| :--- | :--- | :--- |
| **Pool Configuration** | `test.poolMatchGlobs`, `test.threads` | `test.poolOptions.threads` / `poolOptions.forks` |
| **Fake Timers Async** | `vi.advanceTimersByTime` (sync tick) | `vi.advanceTimersByTimeAsync` (ticks async microtasks) |
| **Mock Import Typings** | `vi.mocked(fn, true)` deep flag | `vi.mocked(fn, { deep: true })` |
| **Snapshot Format** | Indented legacy serialization | Prettier-aligned multiline snapshot format |

---

## 2. Legacy Pool Compatibility Workaround

In Vitest v1–v2, `threads: false` was used instead of `pool: "forks"` or single-threaded pool options:

```typescript
// Legacy vitest.config.ts (v1-v3 compatibility)
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // For v1-v3 where threads: false was standard for native bindings:
    threads: false,
    isolate: true,
    testTimeout: 10000,
  },
});
```

---

## 3. Safe Mock Restoration

Older Vitest versions could leak mock implementations across files if `restoreMocks` wasn't enabled:

```typescript
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
```
