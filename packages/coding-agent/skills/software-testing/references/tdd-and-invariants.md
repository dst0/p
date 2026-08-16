# Invariant Testing & 5-Factor Verification Matrix

This guide provides deep technical instructions for designing comprehensive test suites
that verify mathematical, stateful, and domain invariants using iterative post-implementation testing.

---

## Iterative Verification Protocol

Avoid "Big-Bang" test generation at the very end of a project. Instead:
1. **Iterative Feature Slice Loop**:
   - Write clean, focused implementation for a module or unit $\to$ author 10–30 lines of domain invariant tests $\to$ run test runner to verify.
   - Confirm all tests pass before proceeding to dependent modules.
2. **Lean Invariant Assertions**:
   - Write parameterized or table-driven tests for arithmetic invariants, monotonic clocks, retry delays, and graph acyclicity.
   - Avoid hundreds of lines of repetitive boilerplate; test the boundary conditions directly.

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

### 1. Timing & Monotonic Clock Invariant
*Guarantee*: Operations must validate monotonic virtual time; timestamps cannot move backwards ($t_{\text{current}} \ge t_{\text{previous}}$), and retry backoff must compute against the exact failure timestamp:
\[
t_{\text{next}} = t_{\text{failed}} + \text{delay} \times 2^{\text{attempt} - 1}
\]
*Verification Pattern*:
```typescript
test("enforces monotonic clock and exponential retry backoff", () => {
  const engine = new WorkflowEngine();
  engine.start({ workflowId: "wf1", tasks: [{ id: "t1", maxAttempts: 3, retryDelayMs: 10 }] }, { commandId: "c1", now: 0 });
  const claim1 = engine.claim("w1", 0, 5);
  
  // Non-monotonic time rejection
  assert.throws(() => engine.claim("w1", -1, 5), ValidationError);

  // Failed at now: 1 -> next retry strictly at now >= 1 + 10 * 2^0 = 11
  engine.fail(claim1, "err1", { commandId: "f1", now: 1 });
  assert.equal(engine.claim("w1", 10, 5), null, "must not allow claim before backoff expiry");
  const claim2 = engine.claim("w1", 11, 5);
  assert.ok(claim2, "must allow claim at backoff expiry");
});
```

### 2. The Rollback Invariant
*Guarantee*: If an operation fails at step $N$ of $M$, the system state must match the state
prior to step 1 exactly.
*Verification Pattern*:
```typescript
const initialSnapshot = captureStateSnapshot();
await expect(atomicOperationWithFailure()).rejects.toThrow();
const postFailureSnapshot = captureStateSnapshot();
expect(postFailureSnapshot).toEqual(initialSnapshot);
```

### 3. The Idempotency Invariant
*Guarantee*: Executing operation $f(x)$ once produces the exact same system state as executing
$f(x)$ multiple times consecutively.
*Verification Pattern*:
```typescript
const result1 = await executeOperation(payload);
const snapshot1 = captureStateSnapshot();

const result2 = await executeOperation(payload);
const snapshot2 = captureStateSnapshot();

expect(result1).toEqual(result2);
expect(snapshot2).toEqual(snapshot1);
```

### 4. Exact Truncation & Tamper Invariant
*Guarantee*: A parser, stream consumer, or event log must reject incomplete or truncated payloads cleanly.
*Verification Pattern*:
```typescript
const validLog = exportDurableLog();
const truncatedLog = validLog.slice(0, -1);
expect(() => parseLog(truncatedLog)).toThrow(/validationerror|unexpected eof|truncated/i);
```
