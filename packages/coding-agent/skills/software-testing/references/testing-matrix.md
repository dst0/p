# 5-Factor Quality Testing Matrix & Protocol Verification

A comprehensive test suite must verify software across five orthogonal dimensions to prevent regressions, concurrency anomalies, data corruption, and lifecycle leaks.

---

## 1. The 5-Factor Matrix Overview

```
                      +---------------------------------------+
                      |         5-Factor Test Matrix          |
                      +---------------------------------------+
                                          |
        +------------------+--------------+--------------+------------------+
        |                  |                             |                  |
+-------v--------+ +-------v--------+            +-------v--------+ +-------v--------+
| 1. Operational | |  2. Invariant  |            |  4. Crash &    | |  5. Stream     |
|  Permutations  | |  Preservation  |            |  Error Influx  | |  Protocols    |
+----------------+ +----------------+            +----------------+ +----------------+
                           |                             |
                           +-------------> + <-----------+
                                           |
                                   +-------v--------+
                                   | 3. Boundaries  |
                                   |  & Data Extremes|
                                   +----------------+
```

| Dimension | Verification Goal | Concrete Test Scenarios |
| :--- | :--- | :--- |
| **1. Operational Permutations** | Verify all branching configurations, optional hooks, and fallback dispatchers. | Null/default configs vs custom options; primary provider failover to secondary; missing optional dependencies. |
| **2. Invariant Preservation** | Ensure structural properties remain strictly valid across arbitrary operations. | Event log monotonically increasing sequence numbers; total balances conserved; graph acyclicity maintained. |
| **3. Boundaries & Extremes** | Verify zero-length, single-unit, maximum-capacity, and malformed inputs. | Empty files; single-byte chunk streams; 100MB inputs; multi-byte UTF-8 split across byte boundaries; missing trailing newlines. |
| **4. Realistic Crash & Error** | Validate crash tolerance, graceful recovery, and clean resource release under failure. | `EACCES`, `ENOENT`, `ENOSPC`, connection resets (`ECONNRESET`), socket timeouts, thread panics, mid-write crashes. |
| **5. Stream & Event Protocols** | Validate state machine transitions, backpressure, framing, and cancellation signals. | Abort signals before start, during chunk read, and on stream end; pause/resume backpressure; out-of-order frames. |

---

## 2. Factor 1: Operational Permutations & State Transitions

Every configurable system has branching paths determined by environment variables, options objects, and feature flags.

### Key Rules
- Never test only the default configuration path.
- Explicitly test combinations of flags (e.g. `dryRun=true` with `strictMode=true`, `dryRun=false` with `cacheEnabled=false`).
- Exercise fallback chains: when Primary Dispatcher throws, Secondary Dispatcher activates and receives identical input arguments without mutation.

### TypeScript Permutation Example
```typescript
describe("dispatcher fallback chain", () => {
  it("falls back to secondary engine when primary engine throws recoverable error", async () => {
    const primary = {
      execute: vitest.fn().mockRejectedValue(new Error("Rate limit exceeded (429)")),
    };
    const fallback = {
      execute: vitest.fn().mockResolvedValue({ status: "success", data: "from-fallback" }),
    };

    const orchestrator = new DispatcherOrchestrator({ primary, fallback });
    const result = await orchestrator.dispatch({ query: "SELECT 1" });

    expect(primary.execute).toHaveBeenCalledTimes(1);
    expect(fallback.execute).toHaveBeenCalledTimes(1);
    expect(result.data).toBe("from-fallback");
  });
});
```

---

## 3. Factor 2: Invariant Preservation

Invariants are domain truths that must hold before, during, and after every transaction or lifecycle event.

### Key Invariant Types
1. **Monotonicity**: Sequence IDs, fence tokens, and timestamps must never decrease.
2. **Balance Conservation**: Sum of source accounts minus sum of destination accounts must equal zero.
3. **Graph Integrity**: Directed graphs representing task workflows must remain Directed Acyclic Graphs (DAGs) without orphaned references.
4. **Idempotency**: Applying `action(state)` multiple times with identical idempotency keys yields identical state and side effects.

### Property-Based Invariant Verification (Rust `proptest`)
```rust
use proptest::prelude::*;

proptest! {
    #[test]
    fn test_event_log_sequence_monotonicity(events in prop::collection::vec(any::<EventPayload>(), 1..100)) {
        let mut log = AppendOnlyLog::new();
        let mut last_seq = 0;

        for event in events {
            let record = log.append(event).expect("Append must succeed");
            assert!(record.sequence_id > last_seq, "Sequence ID must be strictly monotonic");
            last_seq = record.sequence_id;
        }

        assert_eq!(log.len(), last_seq as usize);
    }
}
```

---

## 4. Factor 3: Boundary Conditions & Data Extremes

Systems frequently fail at edges: empty sets, 1-element collections, max buffer allocations, and encoding borders.

### Critical Edge Cases
- **0 Bytes / Empty Buffer**: Parsing empty strings, empty arrays, or empty streaming chunks must not throw unhandled exceptions or infinite loop.
- **UTF-8 Multi-Byte Splitting**: 4-byte characters (e.g. emojis or CJK ideographs) split across two separate stream chunks must be buffered and decoded properly without replacement characters (`\uFFFD`).
- **Delimiter Omission**: Processing JSONL logs or CSV data where the final line lacks a trailing newline (`\n`).
- **Extreme Buffer Sizes**: Large payloads (e.g., 64MB+) streamed into parsers without memory exhaustion (OOM).

### Node.js Chunk-Split Boundary Test
```typescript
it("correctly decodes 4-byte UTF-8 character split across stream chunk boundaries", async () => {
  // UTF-8 encoding of character: [0xF0, 0x9F, 0x92, 0xBB] (4 bytes)
  const fullBytes = Buffer.from([0xf0, 0x9f, 0x92, 0xbb]);
  const chunk1 = fullBytes.subarray(0, 2); // First 2 bytes (incomplete)
  const chunk2 = fullBytes.subarray(2, 4); // Remaining 2 bytes

  const decoder = new IncrementalUtf8StreamDecoder();
  const res1 = decoder.push(chunk1);
  expect(res1).toBe(""); // Incomplete sequence should not yield partial glyph

  const res2 = decoder.push(chunk2);
  expect(res2).toBe("\u{1F4BB}"); // Decoded once all bytes arrive
});
```

---

## 5. Factor 4: Realistic Crash & Error Injection

Tests must simulate harsh operating environments to ensure error handling is not just theoretical.

### Error Scenarios to Inject
1. **Filesystem Errors**:
   - `ENOENT`: Target file/directory does not exist.
   - `EACCES` / `EPERM`: Read/write permissions denied.
   - `ENOSPC`: Disk full during partial write.
   - `EBUSY` / `ETXTBSY`: File locked by another process on Windows/POSIX.
2. **Network / Socket Failures**:
   - Immediate connection rejection (`ECONNREFUSED`).
   - Mid-payload reset (`ECONNRESET`).
   - Abrupt socket hangup with no HTTP trailers.
3. **Signal Abortions**:
   - Abort signal triggered *before* invocation (`signal.aborted === true`).
   - Abort signal triggered *while* waiting on remote response.
   - Abort signal triggered *during* local disk sync.

### Filesystem Error Injection Test
```typescript
it("safely cleans up temporary write lock when disk runs out of space (ENOSPC)", async () => {
  const mockFs = {
    open: vitest.fn().mockResolvedValue(42),
    write: vitest.fn().mockRejectedValue(Object.assign(new Error("No space left on device"), { code: "ENOSPC" })),
    close: vitest.fn().mockResolvedValue(undefined),
    unlink: vitest.fn().mockResolvedValue(undefined),
  };

  const writer = new AtomicFileWriter({ fs: mockFs });
  await expect(writer.writeAtomic("/tmp/data.bin", Buffer.from("payload"))).rejects.toThrow("ENOSPC");

  // Lockfile and temporary files MUST be closed and deleted on failure
  expect(mockFs.close).toHaveBeenCalledWith(42);
  expect(mockFs.unlink).toHaveBeenCalledWith("/tmp/data.bin.tmp");
});
```

---

## 6. Factor 5: Stream Protocols & Event Sequences

Streaming interfaces must handle continuous data chunks, backpressure signaling, and proper lifecycle cleanup.

### Golden Rules for Stream Processing
- **No Blind `.trim()` on Chunk Boundaries**:
  - Never call `chunk.toString().trim()` or `chunk.split("\n")` assuming lines align with chunk arrivals.
  - Chunks can slice words, numbers, and escape characters in half.
  - Always accumulate unconsumed bytes in an internal carry-over buffer.
- **Backpressure Compliance**:
  - If a consumer returns `false` on `writable.write(chunk)`, producer must pause until `'drain'` event fires.
- **Lifecycle Guarantees**:
  - Every stream must emit exactly one terminal state: either `'end'`/`'finish'` or `'error'`/`'close'`.
  - Resources (file descriptors, sockets) must be released regardless of termination pathway.

### Python Streaming Chunk Fragmentation Test (`pytest`)
```python
import pytest
from io import BytesIO

def test_stream_parser_handles_fragmented_jsonl():
    raw_jsonl = b'{"id":1,"status":"ok"}\n{"id":2,"status":"pending"}\n'
    
    # Slice raw data into arbitrary 5-byte fragments
    fragment_size = 5
    fragments = [raw_jsonl[i:i+fragment_size] for i in range(0, len(raw_jsonl), fragment_size)]
    
    parser = JsonlStreamParser()
    results = []
    
    for frag in fragments:
        records = parser.feed(frag)
        results.extend(records)
        
    results.extend(parser.finish())
    
    assert len(results) == 2
    assert results[0] == {"id": 1, "status": "ok"}
    assert results[1] == {"id": 2, "status": "pending"}
```
