---
name: software-testing
description: "Universal software testing standard: Five-factor matrix, invariant verification, mutation-adversarial testing, and fixture isolation across TypeScript, Rust, Python, and distributed runtimes."
---

# Universal Software Testing Standard

This skill is the multi-tier engineering authority for software verification, test architecture, and adversarial quality assurance across modern programming languages and complex distributed runtimes.

---

## 1. Multi-Tier Skill Navigation

```
software-testing/
├── protocols/
│   ├── five-factor-matrix.md
│   ├── invariant-verification.md
│   ├── mutation-adversarial.md
│   └── fixture-isolation.md
├── languages/
│   ├── typescript/
│   │   ├── SKILL.md
│   │   ├── node-test/v20-v22.md
│   │   ├── vitest/default-v4.md
│   │   ├── vitest/v1-v3-compat.md
│   │   └── jest/modern-esm.md
│   ├── rust/
│   │   ├── SKILL.md
│   │   ├── cargo-test.md
│   │   └── proptest-invariants.md
│   └── python/
│       ├── SKILL.md
│       ├── pytest-fixtures.md
│       └── hypothesis-property.md
├── domains/
│   ├── event-sourcing-streams/
│   │   ├── eof-truncation.md
│   │   └── hash-chain-validation.md
│   ├── distributed-sagas/
│   │   ├── virtual-clock-timing.md
│   │   └── lease-fencing-invariants.md
│   └── async-concurrency/
│       ├── abort-signal-cancellation.md
│       └── race-condition-barriers.md
└── references/
    ├── web-research-playbook.md
    ├── tdd-and-invariants.md
    ├── isolation-and-fixtures.md
    ├── mutation-and-adversarial.md
    └── ecosystem-adapters.md
```

---

## 2. Core Methodologies & Direct Links

### Tier 1: Universal Protocols
- [Five-Factor Testing Matrix](file:///packages/coding-agent/skills/software-testing/protocols/five-factor-matrix.md): Mandatory 5-dimensional coverage (Domain Logic, Invariants, Crash Recovery, Negative Permutations, Boundary Edge Cases).
- [Invariant Verification](file:///packages/coding-agent/skills/software-testing/protocols/invariant-verification.md): Mathematical invariants, inductive proof preservation, and zero-drift state assertion.
- [Mutation & Adversarial Testing](file:///packages/coding-agent/skills/software-testing/protocols/mutation-adversarial.md): Semantic mutation killing, branch-coverage falsification, and tautological test detection.
- [Fixture Isolation](file:///packages/coding-agent/skills/software-testing/protocols/fixture-isolation.md): Hermetic test environments, ephemeral disk isolation, and mock elimination rules.

### Tier 2: Language & Framework Specializations
- [TypeScript Verification Suite](file:///packages/coding-agent/skills/software-testing/languages/typescript/SKILL.md)
  - [Vitest v4+ Modern (Default)](file:///packages/coding-agent/skills/software-testing/languages/typescript/vitest/default-v4.md)
  - [Vitest v1–v3 Compatibility](file:///packages/coding-agent/skills/software-testing/languages/typescript/vitest/v1-v3-compat.md)
  - [Node.js Built-in Test Runner (v20–v22)](file:///packages/coding-agent/skills/software-testing/languages/typescript/node-test/v20-v22.md)
  - [Jest Native ESM](file:///packages/coding-agent/skills/software-testing/languages/typescript/jest/modern-esm.md)
- [Rust Verification Suite](file:///packages/coding-agent/skills/software-testing/languages/rust/SKILL.md)
  - [Cargo Test Integration](file:///packages/coding-agent/skills/software-testing/languages/rust/cargo-test.md)
  - [Proptest Invariants & Shrinking](file:///packages/coding-agent/skills/software-testing/languages/rust/proptest-invariants.md)
- [Python Verification Suite](file:///packages/coding-agent/skills/software-testing/languages/python/SKILL.md)
  - [Pytest Fixtures & Scopes](file:///packages/coding-agent/skills/software-testing/languages/python/pytest-fixtures.md)
  - [Hypothesis Property Testing](file:///packages/coding-agent/skills/software-testing/languages/python/hypothesis-property.md)

### Tier 3: Specialized Domain Runtimes
- [Event-Sourcing & Streaming](file:///packages/coding-agent/skills/software-testing/domains/event-sourcing-streams/)
  - [EOF & Truncation Boundaries](file:///packages/coding-agent/skills/software-testing/domains/event-sourcing-streams/eof-truncation.md)
  - [Hash-Chain SHA256 Integrity](file:///packages/coding-agent/skills/software-testing/domains/event-sourcing-streams/hash-chain-validation.md)
- [Distributed Sagas & Orchestration](file:///packages/coding-agent/skills/software-testing/domains/distributed-sagas/)
  - [Virtual Clock & Deterministic Timing](file:///packages/coding-agent/skills/software-testing/domains/distributed-sagas/virtual-clock-timing.md)
  - [Lease Fencing Invariants](file:///packages/coding-agent/skills/software-testing/domains/distributed-sagas/lease-fencing-invariants.md)
- [Async Concurrency](file:///packages/coding-agent/skills/software-testing/domains/async-concurrency/)
  - [AbortSignal & Cancellation Leaks](file:///packages/coding-agent/skills/software-testing/domains/async-concurrency/abort-signal-cancellation.md)
  - [Race Condition Barriers](file:///packages/coding-agent/skills/software-testing/domains/async-concurrency/race-condition-barriers.md)

---

## 3. Mandatory Execution Flow

1. **Before Writing Code**: Formulate reproducible failing test cases reflecting the exact defect or requirement.
2. **Execute Five Factors**: Apply all 5 dimensions from `protocols/five-factor-matrix.md`.
3. **Isolate Hermetically**: Ensure clean setup and teardown using isolated temporary directories and zero cross-test side effects.
4. **Adversarial Pass**: Run mutation probes (inverting branches, omitting boundary characters) to prove the test suite fails when bugs are introduced.
