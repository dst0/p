# State Reconstruction, Replay & Tamper Detection

In event-sourced architectures, application state is reconstructed by replaying the event log through a pure fold/reducer function: $S_n = \text{reduce}(S_0, [E_0, \dots, E_n])$.

---

## 1. Deterministic Replay Protocol

```typescript
export interface AggregateState {
  version: number;
  data: Record<string, unknown>;
}

export function replayEvents(
  events: ChainedEvent[],
  initialState: AggregateState,
  reducer: (state: AggregateState, event: unknown) => AggregateState
): AggregateState {
  let currentState = initialState;
  let expectedPrevHash = "GENESIS";

  for (const event of events) {
    // 1. Verify Hash Chain
    const expectedHash = computeHash(event.seq, expectedPrevHash, event.data);
    if (event.hash !== expectedHash) {
      throw new Error(`Tampering detected at seq ${event.seq}: hash mismatch`);
    }

    // 2. Project State
    currentState = reducer(currentState, event.data);
    currentState.version = event.seq;
    expectedPrevHash = event.hash;
  }

  return currentState;
}
```

---

## 2. Snapshotting Strategy

For large event logs ($N > 10,000$ events):
1. Persist periodically compacted snapshot: `(SnapshotState, SnapshotSeq, SnapshotHash)`.
2. Resume replay directly from `SnapshotSeq + 1`.
