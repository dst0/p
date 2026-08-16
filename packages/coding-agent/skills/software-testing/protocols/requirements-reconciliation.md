# Requirements Reconciliation & Adversarial Self-Audit

When implementing software against a specification, design document, or user requirements, subtle defects occur not from coding errors in the happy path, but from **omitted clauses** — edge cases, error hierarchies, boundary conditions, or formatting contracts described in the specification that were never explicitly verified.

---

## 1. Requirements Traceability Matrix (RTM) Protocol

Before declaring any feature complete, perform a systematic 1-to-1 reconciliation between the specification clauses and your test suite.

### Step 1: Clause Extraction
Deconstruct the specification into atomic testable assertions across 5 core dimensions:

1. **Public Contracts**: Exact function/method signatures, argument shapes, and return types.
   - *Example (Payment Gateway)*: Does `processPaymentBatch` return `PaymentReceipt[]` or a wrapper `{ receipts: PaymentReceipt[] }`? Verify standard conventions and explicit specification requirements.
2. **Domain Invariants**: Mathematical or business constraints that must hold across all operations.
   - *Example (Ledger Account)*: Can account balance drop below authorized overdraft? Does a reversal exceed the original transaction amount?
3. **Negative & Error Paths**: Explicit error types and failure conditions.
   - *Example (Banking System)*: Which operations throw `InsufficientFundsError`, `InvalidAccountError`, or `OptimisticLockError`?
4. **Idempotency & Concurrency**: Retry behaviors and atomic rollback guarantees.
   - *Example (Transfer Service)*: Does a failed multi-account transfer cleanly roll back temporary reservation tokens? Do stale transaction versions reject safely?
5. **Serialization & Integrity**: Exact wire formats, framing boundaries, and corruption rejection.
   - *Example (Audit Log)*: What happens on unexpected EOF, missing record terminators, or corrupted checksums?

### Step 2: The 1-to-1 Coverage Check
Every identified clause must map to at least one dedicated test in your test suite:

| Specification Clause | Implementation Location | Verification Test |
| :--- | :--- | :--- |
| "Corrupted record hash throws DataIntegrityError" | `ledger-store.ts` (`replayLog`) | `test("rejects audit log with altered record hash")` |
| "Failed batch transfer leaves all balances untouched" | `transfer-engine.ts` (`transferBatch`) | `test("failed transfer batch rolls back debit and releases reservation tokens")` |
| "Batch processing returns array of receipts" | `payment-service.ts` (`processBatch`) | `test("returns direct array of PaymentReceipt matching input items")` |

---

## 2. Adversarial Self-Audit (The "Devil's Advocate" Pass)

Ask yourself the following adversarial questions before finishing:

### 1. The Stream Framing & Truncation Trap
- *Did I use `.trim()` or `.trimEnd()` on stream/log data?*
- If the specification requires a line-delimited format (JSONL, NDJSON, CSV) where each record ends in a required delimiter, using `trimEnd()` will silently swallow a missing trailing delimiter or truncated final byte, preventing proper corruption detection.
- **Rule**: Parse framing delimiters explicitly. If the input is missing its required terminating delimiter, treat it as a truncated or corrupted stream.

### 2. The Signature & Return Type Trap
- *Did I invent unnecessary wrappers around collection results?*
- Unless the specification explicitly mandates an envelope object (e.g. `{ data: T[], nextCursor: string }`), batch operations in standard APIs return `T[]` directly so that callers can inspect `.length`, iterate directly, or map over results without unneeded indirection.

### 3. The Transactional Rollback Trap
- *When an operation fails midway, did I roll back EVERY side effect?*
- Check: In-memory domain state, event logs, sequence counters, and idempotency key registries.
- If step 3 of a 5-step batch fails, steps 1 and 2 must not leave lingering records in the idempotency or deduplication registry.

### 4. Deep Isolation & Immutability Trap
- *Can callers mutate internal state by mutating returned objects?*
- State getters (`accountState(id)`), history getters (`transactionHistory(id)`), and result objects must return deep copies (`structuredClone`).

---

## 3. Pre-Completion Sign-Off Checklist

Before declaring work complete:
- [ ] All public exports defined in the specification exist in the entrypoint module (`index.ts`).
- [ ] `npm test` runs cleanly with 100% green tests.
- [ ] `npm run typecheck` (or `tsc --noEmit`) passes with zero compiler errors.
- [ ] Every clause in the requirements has an explicit, named test case covering both valid and invalid permutations.
