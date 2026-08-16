# Copy-on-Write Snapshot Isolation

Copy-on-write (CoW) workspaces allow transactions to operate on isolated snapshots without blocking readers or mutating persistent state until commit time.

---

## 1. CoW Transaction Workspace Pattern

```typescript
export class CowTransactionWorkspace<T extends Record<string, any>> {
  private baseState: Readonly<T>;
  private delta: Partial<T> = {};
  private active = true;

  constructor(baseState: Readonly<T>) {
    this.baseState = baseState;
  }

  get<K extends keyof T>(key: K): T[K] {
    if (key in this.delta) return this.delta[key]!;
    return this.baseState[key];
  }

  set<K extends keyof T>(key: K, value: T[K]): void {
    if (!this.active) throw new Error("Transaction already finalized");
    this.delta[key] = value;
  }

  rollback(): void {
    this.delta = {};
    this.active = false;
  }

  commit(apply: (delta: Partial<T>) => void): void {
    if (!this.active) throw new Error("Transaction already finalized");
    apply(this.delta);
    this.active = false;
  }
}
```
