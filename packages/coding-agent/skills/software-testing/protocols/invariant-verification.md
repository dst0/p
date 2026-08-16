# Invariant Verification Protocol

Invariants are system properties that must hold true across all valid states and throughout every step of execution.

---

## 1. What Constitutes a Software Invariant

An invariant is an unconditional truth:
1. **Structural Invariants**: Cyclic graph prevention, tree depth constraints, pointer consistency, non-overlapping intervals.
2. **State Invariants**: Monotonic counters, balance non-negativity, state machine exclusivity (e.g. an agent cannot be both `idle` and `running`).
3. **Data Invariants**: SHA-256 hash chains where `block[i].prevHash == sha256(block[i-1])`, canonical JSON ordering.

---

## 2. Assertion & Inductive Testing

### Inductive Testing Pattern
- **Base Case**: Assert invariant holds immediately following initialization or creation.
- **Inductive Step**: Assert that for *every* possible transition $T$, if invariant $I(S)$ holds for state $S$, then $I(T(S))$ holds for state $T(S)$.
- **Failure Reversion**: If transition $T$ fails or throws, assert state reverts to $S$ with $I(S)$ fully intact.

```typescript
// Example: Invariant assertion harness
function assertSystemInvariants(system: StorageEngine): void {
  const index = system.getIndex();
  const entries = system.getLogEntries();
  
  // Invariant 1: Total index entries matches committed log size
  expect(index.size).toBe(entries.filter(e => e.isCommitted).length);
  
  // Invariant 2: Hash chain integrity
  let prevHash = "GENESIS_HASH";
  for (const entry of entries) {
    expect(entry.prevHash).toBe(prevHash);
    prevHash = computeSha256(entry);
  }
}
```

---

## 3. Property-Based Invariant Verification

When verifying complex domains, combine property-based random generation (e.g., `proptest`, `hypothesis`, or `fast-check`) with invariant checking:
1. Generate random command sequences (e.g., Insert, Delete, Update, Flush, Compact).
2. Execute each command against the system under test.
3. Assert system invariants after every single step in the sequence.
4. If an invariant is violated, leverage the property runner's shrinking algorithm to isolate the exact minimal sequence triggering the bug.
