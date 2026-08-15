# TDD & Invariant Testing Matrix

This guide provides deep technical instructions for designing comprehensive test suites
that verify mathematical, stateful, and domain invariants.

---

## The 5-Factor Test Matrix Breakdown

| Factor | Definition | Concrete Test Scenarios |
| :--- | :--- | :--- |
| **1. Positive Path** | Valid workflows and standard inputs | - Baseline execution with representative parameters<br>- Expected output format, status codes, and return shapes<br>- Multiple sequential operations in normal state |
| **2. Negative Path** | Invalid inputs and prohibited states | - Schema validation rejections and invalid types<br>- Unauthorized access or missing credentials<br>- Unknown or missing entity IDs<br>- Specific error class and message assertions |
| **3. Boundary Cases** | Extremities of input spaces | - Empty collections (`[]`, `""`, `{}`)<br>- Single-element collections vs large collections<br>- Numeric boundaries (`0`, `-1`, `MAX_SAFE_INTEGER`)<br>- Truncated inputs (missing terminating newline or trailing bytes)<br>- Unicode edge cases (surrogate pairs, emojis, RTL characters) |
| **4. Crash & Fault** | System failure and external interruptions | - Aborted operations via `AbortSignal`<br>- Network disconnections or timeouts<br>- Unwritable directories / disk full errors (`ENOSPC`, `EACCES`)<br>- Subprocess sudden termination (`SIGTERM`, `SIGKILL`) |
| **5. Invariant Checks** | System guarantees that must never break | - Pre- and post-condition parity<br>- Transactional rollback on mid-operation failure<br>- Idempotency of duplicate operations<br>- Deterministic hashing and ordering stability |

---

## Formulating Invariant Contracts

An invariant is a condition that remains true across all transformations and error states.

### 1. The Rollback Invariant
*Guarantee*: If an operation fails at step $N$ of $M$, the system state must match the state
prior to step 1 exactly.
*Verification Pattern*:
```typescript
// 1. Capture snapshot of initial state
const initialSnapshot = captureStateSnapshot();

// 2. Trigger intentional mid-operation failure
await expect(atomicOperationWithFailure()).rejects.toThrow();

// 3. Assert current state is identical to initial state
const postFailureSnapshot = captureStateSnapshot();
expect(postFailureSnapshot).toEqual(initialSnapshot);
```

### 2. The Idempotency Invariant
*Guarantee*: Executing operation $f(x)$ once produces the exact same system state as executing
$f(x)$ multiple times consecutively.
*Verification Pattern*:
```typescript
const result1 = await executeOperation(payload);
const snapshotAfterFirst = captureStateSnapshot();

const result2 = await executeOperation(payload);
const snapshotAfterSecond = captureStateSnapshot();

expect(result1).toEqual(result2);
expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);
```

### 3. Exact Truncation Boundary Invariant
*Guarantee*: A parser or deserializer must reject incomplete or truncated payloads cleanly,
without hanging or producing partial corrupted records.
*Verification Pattern*:
```typescript
// Test exact byte boundary mutation: strip the trailing newline or byte
const completePayload = serializeValidRecord();
const truncatedPayload = completePayload.slice(0, -1);

expect(() => parseRecord(truncatedPayload)).toThrow(/incomplete|unexpected eof/i);
```
