# Idempotency in Distributed & Local Systems

Idempotency guarantees that performing the same operation multiple times has the same effect as performing it once. It is foundational across HTTP APIs, message queues, databases, payment systems, and local state machines.

---

## 1. Why Idempotency Matters

- **Network retries**: Clients retry on timeout without knowing if the server processed the first attempt (at-least-once delivery).
- **Message queue redelivery**: Kafka, SQS, RabbitMQ may redeliver messages after consumer crashes.
- **User double-clicks**: Frontend submits the same form twice.
- **Crash recovery**: Process restarts mid-operation and replays a write-ahead log.

Without idempotency, retries cause duplicate charges, double inventory deductions, or corrupted state.

---

## 2. Idempotency Key Strategies

### Strategy A: Client-Generated Keys
The client generates a unique key (UUID, request hash) and sends it with each request. The server stores the key alongside the result.

- **Stripe**: `Idempotency-Key` header. Keys expire after 24 hours. Stripe returns the cached response for exact replays and `409 Conflict` for mismatched payloads on the same key.
- **AWS**: `ClientToken` on EC2 `RunInstances`. Identical token + identical parameters = cached result. Same token + different parameters = `IdempotentParameterMismatch`.

### Strategy B: Natural Keys
Use domain-inherent uniqueness (e.g., `(orderId, action)` or `(transactionId, sequenceNumber)`) as the idempotency key. No client-side UUID generation needed.

### Strategy C: Content-Addressable
Hash the entire request body to derive the key. Guarantees that truly identical requests deduplicate automatically, but semantically different requests with the same content cannot be distinguished.

---

## 3. The Payload Verification Trap

A critical mistake is storing only the key without the original request:

```
// WRONG: Key-only registry
Map<string, CachedResponse>

// If key "abc-123" was used for { action: "charge", amount: 100 }
// and caller retries with { action: "refund", amount: 100 } using same key "abc-123"
// -> silently returns the charge response for a refund request
```

**Correct pattern**: Store the full request payload (or a stable hash of it) alongside the key. On retry:
1. **Key exists, payload matches** → return cached response (safe replay)
2. **Key exists, payload differs** → reject with conflict error
3. **Key absent** → execute and store both key and payload

This is how Stripe, AWS, and Google Cloud APIs all work.

```typescript
interface IdempotencyRecord<TReq, TRes> {
  key: string;
  requestFingerprint: string; // hash or serialized payload
  response: TRes;
  createdAt: number;
  expiresAt?: number;
}

function checkIdempotency<TReq, TRes>(
  key: string,
  request: TReq,
  registry: Map<string, IdempotencyRecord<TReq, TRes>>
): TRes | "proceed" | "conflict" {
  const existing = registry.get(key);
  if (!existing) return "proceed";

  const fingerprint = JSON.stringify(request);
  if (existing.requestFingerprint === fingerprint) {
    return structuredClone(existing.response); // safe replay
  }
  return "conflict"; // same key, different request
}
```

---

## 4. Lifecycle & Concurrency

### In-Flight Protection
If a request is currently being processed, a retry with the same key should either:
- **Block** until the first attempt completes, then return its result
- **Reject** with a 429/409 indicating the operation is in progress

### TTL & Garbage Collection
Idempotency records should expire. Stripe uses 24 hours. Choose based on your retry window. Expired keys can be safely reused.

### Failure Semantics
- **Transient failure** (timeout, 503): Delete the idempotency record so the caller can retry.
- **Permanent failure** (400, business rule violation): Store the error as the cached response. Retries should get the same error.

---

## 5. Batch / Transaction Idempotency

When multiple operations execute as an atomic unit:
- Track idempotency keys in a **staging buffer** during the transaction.
- On commit: flush all keys to the persistent registry atomically.
- On rollback: discard the staging buffer. Keys from failed transactions must remain available for future use — they were never committed.

This prevents the subtle bug where a partially-failed batch permanently "consumes" idempotency keys for operations that never actually took effect.

---

## 6. Database-Level Idempotency

PostgreSQL example using an idempotency table with conflict detection:

```sql
CREATE TABLE idempotency_keys (
  key         TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  response    JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours'
);

-- Atomic insert-or-check
INSERT INTO idempotency_keys (key, request_hash, response)
VALUES ($1, $2, $3)
ON CONFLICT (key) DO NOTHING
RETURNING *;

-- Then check if the existing row's request_hash matches
```

---

## 7. Testing Idempotency

Any idempotent operation should be verified against:
1. **Exact retry**: Same key + same payload → identical response, no side effects
2. **Conflicting retry**: Same key + different payload → error
3. **Post-failure retry**: Operation fails, retry succeeds on second attempt
4. **Concurrent submission**: Two identical requests arrive simultaneously
5. **Cross-operation reuse**: Key used for operation A, then attempted for operation B
