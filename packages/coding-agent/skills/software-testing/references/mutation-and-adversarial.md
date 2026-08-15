# Mutation & Adversarial Testing Guide

This guide details techniques for evaluating test suite robustness through deliberate code
perturbations (mutation testing) and adversarial review.

---

## The Mutation Principle

If a line of production code is changed or deleted, at least one test must fail.
If a mutation survives (all tests continue to pass), either:
1. The line of code is dead or redundant (and should be deleted), or
2. The test suite has a gap (and an assertion must be added).

---

## Standard Mutation Operators

When reviewing or writing tests, mentally (or physically) apply these mutations to the implementation:

### 1. Condition Inversion
- Original: `if (value > threshold) { ... }`
- Mutation: `if (value >= threshold) { ... }` or `if (value < threshold) { ... }`
- *Expectation*: A boundary test must fail immediately.

### 2. Return Value Substitution
- Original: `return computedResults;`
- Mutation: `return [];` or `return null;` or `return undefined;`
- *Expectation*: An invariant/positive test must fail immediately.

### 3. Guard & Rollback Removal
- Original: `if (err) { rollback(); throw err; }`
- Mutation: `if (err) { throw err; }` (remove `rollback()`)
- *Expectation*: A rollback invariant test must fail.

### 4. Collection Truncation
- Original: `return items.map(transform);`
- Mutation: `return items.slice(0, 1).map(transform);`
- *Expectation*: A multi-item processing test must fail.

---

## Adversarial Test-Critic Checklist

Before finalizing any task, review the test suite against this checklist:

- [ ] **Assertion Density**: Does every test contain specific assertions on state and return
      values? (Reject tests that only assert `.toBeDefined()` or merely expect no throw).
- [ ] **Branch Exhaustion**: Is every `if`, `else`, `catch`, and `switch` case tested with a
      dedicated test scenario?
- [ ] **Error Message Precision**: Do error assertions verify the exact error class and message
      regex, rather than a generic `.toThrow()`?
- [ ] **Realism**: Are test fixtures testing real system boundaries rather than pre-canned
      mock responses?
- [ ] **No Coverage Bypasses**: Are there zero `/* v8 ignore */` or equivalent suppression comments?
- [ ] **Independence**: Can every test run independently in random order without shared mutable state?
