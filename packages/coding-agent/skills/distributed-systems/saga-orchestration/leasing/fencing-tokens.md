# Distributed Leasing & Fencing Tokens

Leases grant temporary exclusivity to a worker node. To prevent split-brain during GC pauses or network partitions, monotonic fencing tokens must be validated by storage engines.

---

## 1. The Fencing Token Invariant

```
[Coordinator] ─── Grant Lease (Token = 42) ───► [Worker 1]
                                                    │ (Paused by GC)
[Coordinator] ─── Grant Lease (Token = 43) ───► [Worker 2]
                                                    │
                                                    ▼
                                            [Storage Engine]
                                            Accept Write (Token 43)
                                            Highest Seen = 43
                                                    ▲
[Worker 1] (Wakes up) ─── Write (Token 42) ─────────┘
                      REJECTED: 42 < 43!
```

---

## 2. Implementation Protocol

```typescript
export class FencedResourceManager<T> {
  private highestSeenToken = 0;
  private state: T;

  constructor(initial: T) {
    this.state = initial;
  }

  mutate(token: number, apply: (current: T) => T): T {
    if (token <= this.highestSeenToken) {
      throw new Error(`Stale fencing token ${token} rejected. Highest seen: ${this.highestSeenToken}`);
    }
    this.highestSeenToken = token;
    this.state = apply(this.state);
    return this.state;
  }
}
```
