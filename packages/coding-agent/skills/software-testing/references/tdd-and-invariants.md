# TDD, Invariants & Deterministic Verification

Test-Driven Development (TDD) combined with mathematical invariant assertion ensures robust design and prevents regressions.

---

## 1. Red-Green-Refactor Cycle
1. Write a failing test exercising the exact defect or requirement.
2. Verify the failure mode matches expectations (e.g. failing on the right assertion, not on syntax/import errors).
3. Implement minimal code to satisfy the test and preserve all system invariants.
4. Refactor while maintaining 100% green test assertions.

---

## 2. Invariant Integration
Consult [Invariant Verification Protocol](file:///packages/coding-agent/skills/software-testing/protocols/invariant-verification.md) for full mathematical invariant standards.
