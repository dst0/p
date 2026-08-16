# Virtual Clock & Deterministic Timing in Sagas

Distributed workflows and sagas rely on timeouts, heartbeats, and exponential backoff retry policies. Testing them using real wall-clock delays (`sleep`) causes slow, flaky test suites.

---

## 1. Virtual Clock Architecture

A `VirtualClock` allows stepping time forward deterministically without waiting:

```typescript
export interface VirtualClock {
  now(): number;
  advanceBy(ms: number): Promise<void>;
  schedule(delayMs: number, callback: () => void): () => void;
}
```

---

## 2. Testing Saga Expiration & Step Retries

```typescript
it("transitions saga to compensating state upon step timeout", async () => {
  const clock = new DeterministicVirtualClock();
  const saga = new OrderSagaCoordinator({
    clock,
    stepTimeoutMs: 5000,
  });

  const runPromise = saga.start({ orderId: "ord-123" });

  // Advance clock past the step timeout
  await clock.advanceBy(5001);

  const result = await runPromise;
  expect(result.status).toBe("COMPENSATED");
  expect(result.compensatedSteps).toContain("RESERVE_INVENTORY");
});
```
