# Vitest v4+ Modern Test Engineering (Default)

Vitest v4+ is the modern standard runner for TypeScript projects with native ESM, multi-threading isolation, and V8 bytecode instrumentation.

---

## 1. Execution Model & Pool Architecture

Vitest executes test files across isolated worker threads by default:

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    pool: "threads",
    poolOptions: {
      threads: {
        singleThread: false,
        isolate: true,
      },
    },
    globals: false,
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      all: true,
    },
  },
});
```

---

## 2. Mocking & Spy Patterns

Vitest v4 hoists `vi.mock()` calls automatically. Use typed factory functions:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted module mock with clean typings
vi.mock("../src/network-client.ts", () => ({
  fetchRemoteManifest: vi.fn(),
}));

describe("ManifestLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reconstructs schema from remote manifest", async () => {
    const { fetchRemoteManifest } = await import("../src/network-client.ts");
    vi.mocked(fetchRemoteManifest).mockResolvedValue({ version: "4.0.0", entries: [] });

    const loader = new ManifestLoader();
    const manifest = await loader.load();
    expect(manifest.version).toBe("4.0.0");
  });
});
```

---

## 3. Fake Timers & Async Advancements

```typescript
it("processes queue after backoff interval", async () => {
  vi.useFakeTimers();
  try {
    const queue = new RetryQueue({ baseDelayMs: 100 });
    const jobPromise = queue.enqueue("task-1");

    await vi.advanceTimersByTimeAsync(99);
    expect(queue.isPending("task-1")).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await expect(jobPromise).resolves.toBe("task-1-success");
  } finally {
    vi.useRealTimers();
  }
});
```
