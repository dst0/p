# Hash-Chain & SHA-256 Validation Verification

Cryptographic hash chains guarantee tamper resistance across event stores and audit logs.

---

## 1. Hash Chain Specification & Invariant

In a cryptographic event log, each event record includes:
1. `sequence`: Monotonically increasing 64-bit integer.
2. `payload`: Deterministically serialized payload.
3. `prevHash`: SHA-256 hash of previous block (or `0000...0000` genesis).
4. `hash`: `SHA-256(sequence || prevHash || canonical_json(payload))`.

---

## 2. Adversarial Tamper Detection Suite

```typescript
it("detects historical record tampering and aborts replay", () => {
  const store = new TamperProofEventStore();
  store.append({ type: "ACCOUNT_CREATED", id: "acc-1", balance: 100 });
  store.append({ type: "TRANSFER", from: "acc-1", to: "acc-2", amount: 50 });

  // Verify intact chain
  expect(store.validateChainIntegrity()).toBe(true);

  // Adversarially tamper with event #1 in storage
  store.rawMutateEventPayload(0, { type: "ACCOUNT_CREATED", id: "acc-1", balance: 9999 });

  // Assertion: Validation must detect mismatch and throw
  expect(() => store.validateChainIntegrity()).toThrow(/Hash chain validation failed at index 0/);
});
```
