# Compensating Transactions & Reverse Rollback

When a step within a saga fails and retries are exhausted, previously completed steps must be undone in strict reverse chronological order.

---

## 1. Rollback Execution Model

```
Forward Steps:   [Step 1: Reserve Item] ──► [Step 2: Charge Card] ──► [Step 3: Dispatch (FAILS!)]
                                                                               │
                                                                               ▼
Compensation:    [Compensate 1: Unreserve] ◄── [Compensate 2: Refund] ◄────────┘
```

---

## 2. Invariant Rules for Compensations

1. **Idempotency**: Every compensation function must be idempotent. Retrying a compensation action multiple times must yield identical state.
2. **Reverse Order**: Never execute compensations out of sequence. If Step 2 depended on Step 1, Compensate 2 must execute before Compensate 1.
3. **Partial Failure Resilience**: If a compensation step fails, record the failure in a dead-letter queue (DLQ) or retry queue and continue executing remaining compensations.
