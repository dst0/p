# Event Sourcing, Hash Chains & Resilient Log Reconstruction

Event sourcing models state as a continuous sequence of immutable domain events. To guarantee reliability in mission-critical and agentic systems, logs must be cryptographically auditable, tamper-evident, and resilient against sudden power losses, crashes, and partial disk writes.

---

## 1. Hash-Chained Event Architecture

Every event written to the append-only log contains the cryptographic digest of its predecessor, creating an immutable blockchain-style ledger.

```
+---------------------------+     +---------------------------+     +---------------------------+
| Event 0 (Genesis)         |     | Event 1                   |     | Event 2                   |
| - seq: 0                  |     | - seq: 1                  |     | - seq: 2                  |
| - prev_hash: "00000...00" | --> | - prev_hash: "a3f81..."   | --> | - prev_hash: "e79c2..."   |
| - type: "SESSION_INIT"    |     | - type: "TOOL_CALL"       |     | - type: "TOOL_RESULT"     |
| - hash: "a3f81..."        |     | - hash: "e79c2..."        |     | - hash: "b410d..."        |
+---------------------------+     +---------------------------+     +---------------------------+
```

### Event Record Specification
```typescript
import { createHash } from "crypto";

export interface LogRecord<T = unknown> {
  seq: number;
  timestamp: string;
  type: string;
  payload: T;
  prevHash: string;
  hash: string;
}

export function computeRecordHash(
  seq: number,
  timestamp: string,
  type: string,
  payload: unknown,
  prevHash: string,
): string {
  // Deterministic JSON stringification (stable sorted keys)
  const canonicalPayload = canonicalJsonStringify(payload);
  const data = `${seq}|${timestamp}|${type}|${canonicalPayload}|${prevHash}`;
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function canonicalJsonStringify(obj: unknown): string {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJsonStringify).join(",")}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonStringify((obj as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}
```

---

## 2. Preventing Truncation & Corrupt Partial Writes

When a process crashes or disk fills (`ENOSPC`) mid-append:
1. **Never write non-atomic files directly in-place**:
   - For complete log snapshots, write to a sibling file (`${filename}.tmp.${pid}`) and invoke `fs.renameSync()`, which POSIX guarantees to be atomic.
2. **Deterministic Line Framing**:
   - Events are delimited strictly by newline `\n`.
   - Never accept trailing carriage returns or incomplete JSON fragments as fatal corruption; gracefully truncate uncommitted partial tail records.

### Resilient Append-Only Writer
```typescript
import { appendFileSync, openSync, fsyncSync, closeSync } from "fs";

export class ResilientAppendOnlyLog {
  private lastHash = "0".repeat(64);
  private nextSeq = 0;

  constructor(private readonly logFilePath: string) {}

  append<T>(type: string, payload: T): LogRecord<T> {
    const timestamp = new Date().toISOString();
    const seq = this.nextSeq++;
    const hash = computeRecordHash(seq, timestamp, type, payload, this.lastHash);

    const record: LogRecord<T> = {
      seq,
      timestamp,
      type,
      payload,
      prevHash: this.lastHash,
      hash,
    };

    const line = `${JSON.stringify(record)}\n`;
    
    // Write and synchronously flush checkpoint if required
    appendFileSync(this.logFilePath, line, { encoding: "utf8" });
    this.lastHash = hash;

    return record;
  }
}
```

---

## 3. Resilient State Reconstruction (`fromLog`)

`fromLog()` parses the raw event stream, verifies cryptographic integrity, recovers from corrupted/truncated tails, and folds state deterministically.

```
       RAW LOG FILE STREAM
+-----------------------------------------------------------+
| {"seq":0,"hash":"a3f81", ...}\n                           | -> Verified -> Fold into State
| {"seq":1,"hash":"e79c2", ...}\n                           | -> Verified -> Fold into State
| {"seq":2,"hash":"b410d", ...}\n                           | -> Verified -> Fold into State
| {"seq":3,"hash":"c81e7", ...[CRASH / INCOMPLETE TAIL]     | -> Truncate trailing garbage & Warn
+-----------------------------------------------------------+
```

### Deterministic Fold Implementation
```typescript
import { createReadStream, existsSync } from "fs";
import { createInterface } from "readline";

export interface SessionState {
  version: number;
  activeTaskId: string | null;
  completedTasks: Set<string>;
  totalEventsProcessed: number;
}

export async function reconstructStateFromLog(logFilePath: string): Promise<SessionState> {
  const state: SessionState = {
    version: 0,
    activeTaskId: null,
    completedTasks: new Set(),
    totalEventsProcessed: 0,
  };

  if (!existsSync(logFilePath)) {
    return state;
  }

  let expectedSeq = 0;
  let expectedPrevHash = "0".repeat(64);

  const fileStream = createReadStream(logFilePath, { encoding: "utf8" });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: LogRecord;
    try {
      record = JSON.parse(trimmed);
    } catch {
      // Unparseable trailing line caused by abrupt crash
      break;
    }

    // Cryptographic & Sequence Verification
    if (record.seq !== expectedSeq || record.prevHash !== expectedPrevHash) {
      throw new Error(`Log integrity violation at sequence ${record.seq}: hash chain broken`);
    }

    const calculatedHash = computeRecordHash(
      record.seq,
      record.timestamp,
      record.type,
      record.payload,
      record.prevHash,
    );

    if (calculatedHash !== record.hash) {
      throw new Error(`Tampered log record detected at sequence ${record.seq}`);
    }

    // Pure State Fold
    applyEventToState(state, record);

    expectedSeq = record.seq + 1;
    expectedPrevHash = record.hash;
    state.totalEventsProcessed++;
  }

  return state;
}

function applyEventToState(state: SessionState, event: LogRecord): void {
  switch (event.type) {
    case "TASK_STARTED":
      state.activeTaskId = (event.payload as any).taskId;
      break;
    case "TASK_COMPLETED":
      state.completedTasks.add((event.payload as any).taskId);
      if (state.activeTaskId === (event.payload as any).taskId) {
        state.activeTaskId = null;
      }
      break;
    default:
      break;
  }
}
```
