# Requirements Reconciliation & Adversarial Self-Audit

When implementing software against a specification, design document, or user requirements, subtle bugs occur not from coding errors in the happy path, but from **omitted clauses** — edge cases, error types, boundary conditions, or formatting contracts described in the specification that were never explicitly verified.

---

## 1. Requirements Traceability Matrix (RTM) Protocol

Before declaring any feature complete, perform a systematic 1-to-1 reconciliation between the specification clauses and your test suite.

### Step 1: Clause Extraction
Deconstruct the specification into atomic testable assertions:

1. **Public Contracts**: Exact function/method signatures, argument shapes, and return types.
   - *Example*: Does `executeBatch` return `ItemResult[]` or a wrapper `{ results: ItemResult[] }`? Check standard conventions or explicit spec requirements.
2. **Domain Invariants**: Mathematical or business constraints that must hold across all operations.
   - *Example*: Can available inventory go negative? Does a release exceed the specific reservation?
3. **Negative & Error Paths**: Explicit error types and failure conditions.
   - *Example*: Which operations throw `ValidationError` vs `ConcurrencyError`?
4. **Idempotency & Concurrency**: Retry behaviors and atomic rollback guarantees.
   - *Example*: Does a failed batch consume command IDs? Do concurrent/stale versions reject safely?
5. **Serialization & Integrity**: Exact wire formats, framing boundaries, and corruption rejection.
   - *Example*: What happens on unexpected EOF or truncated trailing bytes?

### Step 2: The 1-to-1 Coverage Check
Every identified clause must map to at least one dedicated test in your test suite:

| Specification Clause | Implementation Location | Verification Test |
| :--- | :--- | :--- |
| "Any truncation throws ValidationError" | `store.ts` (`importLog`) | `test("rejects truncated log missing trailing delimiter")` |
| "Failed batch leaves state and IDs untouched" | `engine.ts` (`executeBatch`) | `test("failed batch rolls back state and releases command IDs")` |
| "executeBatch returns item results" | `engine.ts` (`executeBatch`) | `test("executeBatch returns array of CommandResult")` |

---

## 2. Adversarial Self-Audit (The "Devil's Advocate" Pass)

Ask yourself the following adversarial questions before finishing:

### 1. The Framing & Truncation Trap
- *Did I use `.trim()` or `.trimEnd()` on stream/log data?*
- If the specification requires a line-delimited format (JSONL, CSV) where each record ends in `\n`, using `trimEnd()` will silently swallow a missing trailing newline or truncated final byte, preventing proper corruption detection.
- **Rule**: Parse delimiters explicitly. If the input is missing its terminating delimiter, treat it as a truncated/corrupted stream.

### 2. The Signature & Return Type Trap
- *Did I invent unnecessary wrappers around collection results?*
- Unless the specification explicitly defines `{ results: T[] }`, batch operations in standard APIs return `T[]` directly so that callers can inspect `.length`, iterate directly, or map over results.

### 3. The Transactional Rollback Trap
- *When an operation fails midway, did I roll back EVERY side effect?*
- Check: In-memory domain state, event logs, sequence counters, and idempotency key registries.
- If step 3 of a 5-step batch fails, steps 1 and 2 must not leave lingering records in the idempotency registry.

### 4. Deep Isolation & Immutability Trap
- *Can callers mutate internal state by mutating returned objects?*
- State getters (`state(id)`), history getters (`history(id)`), and result objects must return deep copies (`structuredClone`).

---

## 3. Pre-Completion Sign-Off Checklist

Before calling `finish_work` or completing the task:
- [ ] All public exports defined in the specification exist in the entrypoint module (`index.ts`).
- [ ] `npm test` runs cleanly with 100% green tests.
- [ ] `npm run typecheck` (or `tsc --noEmit`) passes with zero compiler errors.
- [ ] Every clause in the requirements has an explicit, named test case covering both valid and invalid permutations.
