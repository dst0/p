# Differential Tracing & Reproducible Regression Engineering

When debugging subtle logic errors, race conditions, or state machine corruptions, comparing execution traces between working and broken baselines provides immediate clarity on where behavior diverged.

---

## 1. Differential Trace Comparison

Differential tracing captures structured execution logs from two runs (e.g. baseline vs regressed, or passing input vs failing edge case) and computes a diff of the state progression.

```
+------------------------------------+     +------------------------------------+
|  PASSING EXECUTION TRACE (Golden)  |     |   FAILING EXECUTION TRACE (Defect) |
+------------------------------------+     +------------------------------------+
| 1. [INIT] session_id = "s1"        |     | 1. [INIT] session_id = "s2"        |
| 2. [ACQUIRE] lock = "task-1"       |     | 2. [ACQUIRE] lock = "task-2"       |
| 3. [PARSE] buffer = 24 bytes       |     | 3. [PARSE] buffer = 12 bytes (HALF)|
| 4. [STATE] status = "READY"        |     | 4. [ERROR] JSONParseError: unexp   | <-- DIVERGENCE POINT
| 5. [EMIT] event = "COMPLETED"      |     | 5. [ZOMBIE] lock remains locked    |
+------------------------------------+     +------------------------------------+
```

### Trace Diffing Procedure
1. **Instrument Entry & Exit Points**:
   - Log function entry arguments, return values, and state machine transitions.
   - Use structured JSON logs with event names, entity IDs, sequence numbers, and timestamps.
2. **Normalize Volatile Data**:
   - Strip dynamic PIDs, random UUIDs, and absolute timestamps to make traces diffable via `diff -u golden.log failing.log`.
3. **Pinpoint the First Point of Divergence**:
   - The bug is rarely at the final error line; the actual defect occurred at the *first line where the traces diverged*.

---

## 2. Crafting Reproducible Regression Tests

Before making any code edits to fix a bug:
1. **Identify the Smallest Possible Surface Area**:
   - Strip unrelated dependencies, file watchers, or network calls.
2. **Create the Regression Test File**:
   - Location: `packages/coding-agent/test/suite/regressions/<issue-number>-<short-slug>.test.ts`.
3. **Verify the Red-Green-Refactor Cycle**:
   - Run the test against unfixed code: it MUST fail.
   - Apply the fix in source code.
   - Run the test again: it MUST pass.

### Example Regression Test Template
```typescript
// packages/coding-agent/test/suite/regressions/412-stream-utf8-chunk-split.test.ts
import { describe, expect, it } from "vitest";
import { IncrementalStreamDecoder } from "../../src/core/stream-decoder.ts";

describe("Regression #412: IncrementalStreamDecoder handles split UTF-8 bytes without corruption", () => {
  it("reproduces and verifies fix for multi-byte emoji split across chunks", () => {
    const decoder = new IncrementalStreamDecoder();
    
    // Bug #412: Splitting the 4-byte rocket emoji bytes [0xF0, 0x9F, 0x98, 0x80]
    // previously resulted in replacement character '\uFFFD'
    const chunkA = Buffer.from([0xf0, 0x9f]);
    const chunkB = Buffer.from([0x98, 0x80]);

    const resultA = decoder.decode(chunkA);
    const resultB = decoder.decode(chunkB);

    expect(resultA).toBe("");
    expect(resultB).toBe("😀");
  });
});
```

---

## 3. Isolating Concurrency & Timing Races

Race conditions appear non-deterministic when driven by unpredictable OS thread scheduling. To make them 100% deterministic:

1. **Serialize Asynchronous Order via Promises**:
   - Control the exact resolution order of promises rather than relying on `setTimeout(..., 50)`.
2. **Barrier Synchronization**:
   - Use deferred promises to hold one branch until another branch reaches a checkpoint:

```typescript
function createDeferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it("deterministically reproduces concurrent lease preemption", async () => {
  const step1Arrived = createDeferred();
  const allowStep1Proceed = createDeferred();

  const worker1 = async () => {
    step1Arrived.resolve();
    await allowStep1Proceed.promise;
    return store.write("key", "val1", { leaseToken: 1 });
  };

  const worker2 = async () => {
    await step1Arrived.promise; // Ensure worker 1 started first
    store.acquireLease(); // Increments token to 2
    allowStep1Proceed.resolve(); // Now let worker 1 attempt commit with stale token 1
  };

  await Promise.allSettled([worker1(), worker2()]);
  expect(store.read("key")).not.toBe("val1"); // Stale write must be rejected
});
```
