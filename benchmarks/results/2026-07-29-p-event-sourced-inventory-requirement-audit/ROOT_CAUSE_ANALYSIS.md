# v110 vs v112 Benchmark Regression: Root Cause Analysis

**Date:** 2026-07-29
**Task:** event-sourced-inventory
**Model:** mini-pc/sokann-qwen-27b
**Benchmark:** Hidden invariant verification (22 checks, weighted scoring)

## Executive Summary

**v112 scored 59/100 vs v110's ~89/100 — a ~30-point regression.**

The root cause is **requirement-audit overhead**. The v112 agent was configured with a "requirement-to-evidence audit" system that forced the agent to produce structured compliance checks for each requirement. This consumed significant token budget that would otherwise be spent on implementation, resulting in:

1. **Timeout** (v112 timed out at 1800s, v110 completed)
2. **Weaker code validation** (fromLog doesn't verify hash chain, positions, or domain transitions)
3. **Missing error handling** (no ValidationError class, generic Error thrown everywhere)
4. **Incomplete batch rollback** (truncateAfter vs restoreFromEvents)

## Score Comparison

| Category           | v110 (exact) | v112 (requirement-audit) |  Delta   |
| ------------------ | :----------: | :----------------------: | :------: |
| **Weighted score** |     ~89      |            59            | **-30**  |
| Timed out?         |      No      |           Yes            | +timeout |
| Tool calls         |     ~20      |            25            |    +5    |
| Total tokens       |    ~350K     |           392K           |   +42K   |
| Tool errors        |      ~2      |            8             |    +6    |

## Code-Level Differences

### 1. fromLog: Hash Chain Validation

**v110 (exact):** Validates the entire hash chain during log replay. For each event, it:

- Verifies position is sequential (1, 2, 3...)
- Verifies previousHash chains correctly
- Recomputes SHA-256 hash and compares against stored hash
- Validates commandId uniqueness across entire log
- Validates per-SKU version progression
- Validates domain transitions (first event must be create-sku)
- Uses `ValidationError` class for structured errors

```typescript
// v110 fromLog validation (complete)
const canonicalInput = {
  position: evt.position,
  version: evt.version,
  commandId: evt.commandId,
  type: evt.type,
  sku: evt.sku,
  data: evt.data,
  previousHash: evt.previousHash,
};
const computedHash = createHash("sha256").update(canonical).digest("hex");
if (evt.hash !== computedHash) {
  throw new ValidationError(`Event at line ${i}: hash mismatch`);
}
// Plus: position, previousHash, commandId uniqueness, SKU version, domain transition
```

**v112 (requirement-audit):** Minimal validation. Accepts events from log without verifying:

- Hash chain integrity (no recomputation)
- Position ordering
- Command ID uniqueness
- Domain transitions

```typescript
// v112 fromLog (minimal)
// Just parses JSON and pushes events
// No hash verification, no position validation
```

### 2. executeBatch: Rollback Strategy

**v110 (exact):** Uses `restoreFromEvents()` — snapshots event array before batch, restores it on failure. This is a proper rollback.

**v112 (requirement-audit):** Uses `truncateAfter()` — removes events by position. Less robust because:

- If event positions are corrupted, truncation fails silently
- No snapshot means no guaranteed restore point

### 3. Error Handling

**v110 (exact):** Has `ValidationError` class extending `Error` with semantic error messages.

**v112 (requirement-audit):** Uses generic `throw new Error(...)` everywhere. No structured error types.

### 4. Type System

**v110 (exact):** Uses `InventoryEvent` with `data: Record<string, unknown>` — flexible but safe.

**v112 (requirement-audit):** Uses `BaseEvent` with explicit `quantity?`, `orderId?` fields — more type-safe but requires manual canonical payload construction.

## Why Did This Happen?

The v112 agent was configured with a "requirement-to-evidence audit" system. This system forces the agent to:

1. Parse the requirements
2. Create a checklist of requirements
3. For each requirement, produce evidence that it was satisfied
4. Store the evidence in a structured format
5. Cross-reference evidence against requirements

This overhead consumed ~40K additional tokens and ~5 additional tool calls. The agent ran out of budget before it could complete the full implementation with proper validation.

The v110 agent ("exact" mode) went straight to implementation without the audit overhead, leaving budget for:

- Complete hash chain validation
- Domain transition validation
- Proper batch rollback
- Structured error handling

## Recommendations

1. **Remove or optimize requirement-audit overhead**: The audit system adds compliance cost but reduces implementation quality. Consider:
   - Only requiring audit for critical requirements
   - Reducing evidence verbosity
   - Parallelizing audit with implementation

2. **Increase token budget for audit mode**: If audit is mandatory, increase the token limit to compensate for overhead.

3. **Prioritize implementation over audit**: If the agent is running low on tokens, skip audit steps and focus on code quality.

4. **Consider hybrid approach**: Run audit only after implementation is complete, not interleaved.

## Conclusion

The 30-point regression is directly caused by requirement-audit overhead consuming token budget needed for implementation quality. The v110 "exact" mode produces better code because it focuses entirely on implementation without compliance overhead.
