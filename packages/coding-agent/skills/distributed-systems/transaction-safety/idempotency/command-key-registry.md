# Command Idempotency Key Registry

Idempotency guarantees that executing the same command multiple times produces the exact same effect and response as executing it once.

---

## 1. Idempotency Registry Lifecycle

```typescript
export interface IdempotencyRecord<T = unknown> {
  key: string;
  status: "IN_FLIGHT" | "COMPLETED" | "FAILED";
  response?: T;
  createdAt: number;
}

export class IdempotencyRegistry<T> {
  private records = new Map<string, IdempotencyRecord<T>>();

  async execute(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.records.get(key);
    if (existing) {
      if (existing.status === "COMPLETED") return existing.response!;
      if (existing.status === "IN_FLIGHT") {
        throw new Error(`Concurrent execution in-flight for key: ${key}`);
      }
    }

    this.records.set(key, { key, status: "IN_FLIGHT", createdAt: Date.now() });

    try {
      const response = await fn();
      this.records.set(key, { key, status: "COMPLETED", response, createdAt: Date.now() });
      return response;
    } catch (err) {
      this.records.delete(key); // Allow retry on transient failure
      throw err;
    }
  }
}
```
