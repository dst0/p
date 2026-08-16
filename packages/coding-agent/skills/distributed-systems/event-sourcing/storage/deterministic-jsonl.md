# Deterministic Append-Only JSONL Storage

JSON Lines (JSONL) is the optimal storage format for streaming event logs due to its simplicity, human readability, and streamable parsing.

---

## 1. Storage Invariants & Formatting Rules

1. **Strict Canonical Key Ordering**: To ensure deterministic hashing, JSON keys must be sorted alphabetically before serialization (`JSON.stringify(sortKeys(obj))`).
2. **Explicit Newline Framing**: Every record MUST be terminated with a single `\n` (`0x0A`).
3. **Atomic Append with Flush**: Use file descriptor append mode (`flags: "a"`) followed by `fsync` / `fdatasync` for durable persistence.

```typescript
import { openSync, writeSync, fsyncSync, closeSync } from "fs";

export function appendJsonlRecord(filePath: string, record: unknown): void {
  const serialized = JSON.stringify(record, Object.keys(record as any).sort()) + "\n";
  const fd = openSync(filePath, "a");
  try {
    writeSync(fd, serialized);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
```
