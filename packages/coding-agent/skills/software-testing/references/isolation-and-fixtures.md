# Realistic Fixtures & Test Isolation

This guide outlines rules for constructing authentic, reliable test fixtures and avoiding
the pitfalls of superficial mocks and tautological assertions.

---

## Why Superficial Mocks are Prohibited

Superficial mocks (such as replacing complex I/O with hardcoded `() => true` stubs) create
a false sense of security. They test the mock implementation rather than the system's actual
behavior, masking:
- Filesystem permission and path resolution errors
- Asynchronous timing issues and unhandled promise rejections
- Missing data conversions or serialization discrepancies
- Stream backpressure and buffer management issues

---

## Patterns for Realistic Fixtures

### 1. Isolated Temporary Filesystems
Always use real filesystem directories created in temporary storage with guaranteed cleanup.
```typescript
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("FileSystem Component", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "test-fixture-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("handles real filesystem operations", async () => {
    const filePath = join(testDir, "sample.txt");
    writeFileSync(filePath, "data");
    // exercise actual logic against real filesystem
  });
});
```

### 2. Real AbortSignals and Cancellation
Never mock `AbortSignal` with a plain boolean. Use real `AbortController` instances to test
listeners, event propagation, and cleanup.
```typescript
it("cancels in-flight operation and cleans up listeners", async () => {
  const controller = new AbortController();
  const promise = longRunningTask({ signal: controller.signal });

  controller.abort();

  await expect(promise).rejects.toThrow(/abort/i);
  // Verify no dangling event listeners or background timers remain
});
```

### 3. Local In-Memory Network / Subprocess Fixtures
When testing network or IPC communication:
- Bind to ephemeral ports (`localhost:0`) or in-memory streams.
- Test actual socket lifecycle (connect, write, close, error).
- Assert on real serialized wire formats.

---

## Mocking Hierarchy (What to Mock vs What to Keep Real)

| Component | Preferred Approach | Why |
| :--- | :--- | :--- |
| **Filesystem (FS)** | Real temp directories | Catches path separator, permission, and locking bugs. |
| **Abort Signals** | Real `AbortController` | Verifies event listener registration and memory leak freedom. |
| **Timers** | Fake timers (clock control) | Allows fast, deterministic testing of timeouts without real sleeps. |
| **External Paid APIs** | Deterministic faux provider | Simulates exact wire schema and error statuses without network costs. |
| **Subprocesses** | Real lightweight commands or mock runner | Validates argument quoting, stdio pipe buffering, and exit codes. |
