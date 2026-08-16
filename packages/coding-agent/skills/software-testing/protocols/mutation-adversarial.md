# Mutation & Adversarial Testing Protocol

Coverage percentage alone is an insufficient metric for test quality. High line coverage can easily mask tautological assertions, weak mocks, or unexercised decision branches.

---

## 1. Adversarial Review Principle

Every test suite must be approached with an adversarial mindset: **How can this test suite be deceived into passing despite broken implementation logic?**

### Types of Inadequate Tests
1. **Tautological Assertions**: Asserting mock return values or tautologies (e.g. `expect(mockFn).toHaveBeenCalled()`, without asserting resulting state transformations).
2. **Weak Oracles**: Asserting generic truthiness (`expect(result).toBeTruthy()`) instead of exact structural and value equality.
3. **Happy-Path-Only Mocks**: Mocks that only resolve successfully and never simulate socket disconnects, backpressure, rate-limiting, or permission rejections.

---

## 2. Semantic Mutation Testing

Introduce deliberate mutations into the source code under test to prove that the test suite catches them:

| Mutation Category | Source Transformation | Required Test Result |
| :--- | :--- | :--- |
| **Relational Inversion** | `<` replaced with `<=`, `===` with `!==` | Immediate assertion failure |
| **Boundary Deletion** | Removal of `+ 1`, `- 1`, or string slicing | Truncation / boundary failure |
| **Short-Circuit Bypass** | `if (guard) return;` commented out | Invariant / negative test failure |
| **Rollback Deletion** | Removing `catch { rollback(); }` | Invariant leak assertion failure |
| **Hash Nullification** | Constant string returned in hash digest | Chain validation test failure |

---

## 3. Adversarial Test-Critic Protocol

When authoring or refactoring complex modules:
1. Identify all assumptions in the specification.
2. Formulate test cases that explicitly try to break those assumptions (e.g., duplicate IDs, concurrent re-entrancy, clock skew).
3. Verify that zero mutants survive. If a mutated implementation still passes the test suite, write additional targeted tests until the mutant is killed.
