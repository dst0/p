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

1. **Iterative Verification (Code & Test in Slices)**: Avoid postponing all testing to the very end of a project.
   Implement focused functionality, then immediately author domain tests to verify correctness, edge cases, and contracts before moving to subsequent modules.
2. **Domain-Specific Test Structure (No Branch Fillers)**: Never create generic catch-all or
   branch-filler test files (e.g. `branches.test.ts`, `coverage.test.ts`). Organize all tests into
   descriptively named files grouped by domain, feature responsibility, and lifecycle semantics.
3. **100% Branch Coverage via Real Permutations**: Strive for 100% branch coverage by exercising real
   operational permutations: optional configuration hooks, fallback dispatcher chains, default parameter
   paths, and event sequences with and without initial lifecycle triggers.
4. **Lean Invariant Verification**: Verify system invariants (monotonic clocks, retry delays, rollback guarantees,
   DAG acyclicity, idempotency) with compact table-driven assertions rather than verbose boilerplate.
5. **Meaningful Verification Over Line Coverage**: Tests must verify domain logic, boundary
   conditions, state invariants, and realistic crash recovery. Passing coverage gates with
   tautological assertions or superficial mocks is prohibited.
6. **Zero Dead Code**: Never use ignore pragmas (e.g. `v8 ignore`) to bypass coverage gates.
   All code must be reachable and exercised by tests.
7. **Ecosystem & Library Research**: Before implementing unfamiliar APIs, asynchronous state machines,
   or complex protocols, research current ecosystem best practices, cancellation semantics, error types, and edge cases.
8. **Reproducible Regression First for Bug Fixes**: When fixing an existing bug, write a failing regression test first,
   execute the test runner to confirm failure, then write the minimal fix.

---

## 4-Phase Testing Protocol

### Phase 1: Research & Contract Discovery
Before writing code:
- Identify public APIs, data contracts, and error semantics.
- If using external libraries or runtime APIs, consult documentation or search for known error modes and cancellation caveats.
- See detailed guidance: [`references/web-research-playbook.md`](./references/web-research-playbook.md).

### Phase 2: Implementation & Immediate Verification
- Write clean, modular implementation code for the current feature slice.
- Immediately author dedicated domain tests to exercise the newly written functionality.
- Run the test suite (`npm test`, `pytest`, `cargo test`) to verify green status before advancing.

### Phase 3: The 5-Factor Test Matrix
Every change must be validated across all 5 dimensions:
1. **Positive Path**: Happy path scenarios with standard valid inputs and expected return shapes.
2. **Negative Path**: Invalid inputs, type mismatches, rejected promises, unauthorized states, and error handling.
3. **Boundary & Edge Cases**: Empty collections, zero/negative values, single-element limits, buffer boundaries, and incomplete/truncated streams.
4. **Crash, Fault & Recovery**: Abort signals (`AbortController`), timeouts, unexpected process termination, and partial failure rollback.
5. **Invariant Preservation**: Pre- and post-condition checks ensuring that failed operations leave state, registries, and logs completely uncorrupted.
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
