# Async Race Condition & Barrier Synchronization Testing

Concurrent async operations can interleave in unpredictable orders. Testing for race conditions requires explicit barrier synchronization rather than arbitrary sleeps.

---

## 1. Async Barrier Pattern

An `AsyncBarrier` halts concurrent promises until all expected parties have arrived at the synchronization point:

```typescript
export class AsyncBarrier {
  private count: number;
  private resolveAll!: () => void;
  private promise: Promise<void>;
  private arrived = 0;

  constructor(count: number) {
    this.count = count;
    this.promise = new Promise((resolve) => {
      this.resolveAll = resolve;
    });
  }

  async wait(): Promise<void> {
    this.arrived++;
    if (this.arrived >= this.count) {
      this.resolveAll();
    }
    return this.promise;
  }
}
```

---

## 2. Testing Double-Spend and Concurrent Mutations

```typescript
it("guarantees atomic state update under simultaneous concurrent requests", async () => {
  const barrier = new AsyncBarrier(2);
  const account = new BankAccount(100);

  async function withdrawWorker(amount: number) {
    await barrier.wait(); // Release both requests at the exact same millisecond
    return account.withdraw(amount);
  }

  const results = await Promise.allSettled([
    withdrawWorker(80),
    withdrawWorker(80),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect(account.getBalance()).toBe(20);
});
```
