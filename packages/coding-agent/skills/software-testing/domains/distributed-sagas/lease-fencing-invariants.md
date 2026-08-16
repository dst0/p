# Distributed Lease Fencing Invariants

When coordinating active workers across distributed nodes, split-brain conditions and stale zombie processes can write to shared state if leases are not protected by monotonic fencing tokens.

---

## 1. Fencing Token Protocol

1. When a worker acquires or renews a lease, the coordinator grants a strictly monotonic token: $T_n > T_{n-1}$.
2. Every mutation sent to the storage engine must carry token $T$.
3. Storage rejects any write where $T < T_{highest\_seen}$.

---

## 2. Invariant Verification Test

```typescript
it("rejects delayed zombie worker writes after lease reassignment", async () => {
  const coordinator = new LeaseCoordinator();
  const storage = new FencedStorageEngine();

  // Worker 1 acquires lease
  const lease1 = await coordinator.acquire("resource-A"); // Token = 1
  
  // Lease expires due to network pause on Worker 1
  coordinator.expireLease("resource-A");

  // Worker 2 acquires lease
  const lease2 = await coordinator.acquire("resource-A"); // Token = 2
  await storage.write("resource-A", "data-from-worker-2", lease2.fencingToken);

  // Stale Worker 1 wakes up and attempts to write with Token 1
  await expect(
    storage.write("resource-A", "stale-data-worker-1", lease1.fencingToken)
  ).rejects.toThrow(/Fencing token rejected: token 1 < highest 2/);

  // Assert storage retained worker 2's data
  expect(await storage.read("resource-A")).toBe("data-from-worker-2");
});
```
