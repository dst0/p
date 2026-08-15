---
name: software-testing
description: >-
  Universal software testing standard across all programming languages and frameworks.
  Use whenever implementing new features, modifying existing code, fixing bugs, refactoring,
  or writing tests. Enforces TDD, mandatory web search for ecosystem-specific edge cases,
  5-factor test matrices, realistic fixtures without fake mocks, and mutation self-verification.
---

# Universal Software Testing Standard

This skill defines the mandatory protocol for designing, implementing, and verifying tests
across all languages and frameworks.

## Core Invariants

1. **Meaningful Verification Over Line Coverage**: Tests must verify domain logic, boundary
   conditions, state invariants, and realistic crash recovery. Passing coverage gates with
   tautological assertions or superficial mocks is prohibited.
2. **Zero Dead Code**: Never use ignore pragmas (e.g. `v8 ignore`) to bypass coverage gates.
   All code must be reachable and exercised by tests.
3. **Mandatory Web Search**: Before implementing non-trivial logic, asynchronous state machines,
   or testing complex APIs, search the web to clarify current ecosystem best practices,
   concurrency caveats, error types, and edge cases.
4. **Reproducible Regression First (TDD)**: When fixing a bug, write a failing regression test
   first, execute the test runner to confirm failure, then write the minimal fix.

---

## 4-Phase Testing Protocol

### Phase 1: Research & Discovery (Web Search)
Before writing tests or code:
- Search the web for library-specific error modes, signal/cancellation semantics, and standard
  test harness conventions.
- Identify common pitfalls (e.g., event listener leaks, stream truncation, race conditions).
- See detailed guidance: [`references/web-research-playbook.md`](./references/web-research-playbook.md).

### Phase 2: Test-First Strategy (TDD)
- Define the test file and test cases before touching implementation files.
- Run the test suite to observe the failure (ensuring the test is not vacuously passing).
- Write implementation to satisfy the test, then re-run to verify passage.

### Phase 3: The 5-Factor Test Matrix
Every change must be validated against all 5 aspects:
1. **Positive Path**: Happy path scenarios with standard valid inputs and expected return types.
2. **Negative Path**: Invalid inputs, type mismatches, rejected promises, unauthorized states,
   and custom exception validation.
3. **Boundary & Edge Cases**: Empty collections, zero values, single-element collections,
   maximum buffer limits, unicode edge cases, off-by-one indices, and missing end-of-line tokens.
4. **Crash, Fault & Recovery**: Abort signals (`AbortController`), timeouts, process termination,
   unwritable disks, network disconnections, and partial rollback validation.
5. **Invariant Preservation**: Pre- and post-condition checks ensuring that failed operations
   leave state, registries, and file structures completely uncorrupted.
- See detailed matrix guide: [`references/tdd-and-invariants.md`](./references/tdd-and-invariants.md).

### Phase 4: Adversarial Self-Check & Mutation Analysis
Before considering testing complete:
- Perform mental and physical mutation testing: invert conditional checks (`<` to `<=`, `===` to `!==`),
  remove rollback statements, or return empty arrays in implementation code.
- Verify that at least one test fails for each mutated branch. If no test fails, the test suite is deficient.
- Ensure fixtures use realistic subsystems (temp directories, real git remotes, real signals) rather
  than coarse mock stubs.
- See detailed isolation guide: [`references/isolation-and-fixtures.md`](./references/isolation-and-fixtures.md)
  and mutation guide: [`references/mutation-and-adversarial.md`](./references/mutation-and-adversarial.md).

---

## Deep-Dive References

- [Web Research Playbook](./references/web-research-playbook.md) — Query formulation and ecosystem research.
- [TDD & Invariant Matrix](./references/tdd-and-invariants.md) — Mathematical and domain invariant testing.
- [Isolation & Fixtures](./references/isolation-and-fixtures.md) — Realistic environments vs fake mock traps.
- [Mutation & Adversarial Testing](./references/mutation-and-adversarial.md) — Inversion analysis and test-critic checklist.
- [Ecosystem Adapters](./references/ecosystem-adapters.md) — Idiomatic playbooks for TypeScript, Python, Rust, Go, and C++.
