# SHA-256 Cryptographic Hash Chaining

Hash chaining protects historical events from retroactive tampering, truncation, or insertion.

---

## 1. Mathematical Construction

For an event sequence $E_0, E_1, \dots, E_n$:
- $H_0 = \text{SHA-256}(\text{"GENESIS"} \parallel \text{canonical}(E_0))$
- $H_i = \text{SHA-256}(H_{i-1} \parallel i \parallel \text{canonical}(E_i))$

```typescript
import { createHash } from "crypto";

export interface ChainedEvent<T = unknown> {
  seq: number;
  prevHash: string;
  hash: string;
  data: T;
}

export function createChainedEvent<T>(seq: number, prevHash: string, data: T): ChainedEvent<T> {
  const serialized = JSON.stringify(data, Object.keys(data as any).sort());
  const hash = createHash("sha256")
    .update(`${prevHash}:${seq}:${serialized}`)
    .digest("hex");

  return { seq, prevHash, hash, data };
}
```
