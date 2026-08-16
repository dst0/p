---
name: architecture-and-refactoring
description: Architecture standards, modular decomposition, 4-module pattern, strict type systems, and 300-line physical limit refactoring protocols.
---

# Architecture & Refactoring Engineering Standard

This skill is the multi-tier engineering authority for scalable software architecture, modular decomposition, clean type systems, and behavior-preserving refactoring.

---

## 1. Multi-Tier Skill Navigation

```
architecture-and-refactoring/
├── SKILL.md
├── modular-decomposition/
│   ├── 4-module-pattern.md
│   ├── anti-circular-dependencies.md
│   └── file-size-limits.md
└── type-systems/
    ├── typescript/
    │   ├── strip-only-mode.md
    │   ├── contract-fidelity.md
    │   └── generics-and-discriminated-unions.md
    └── rust/
        ├── newtype-and-traits.md
        └── error-handling-thiserror-anyhow.md
```

---

## 2. Core Pillars & Direct Links

### Pillar 1: Modular Decomposition
- [The 4-Module Separation Pattern](file:///packages/coding-agent/skills/architecture-and-refactoring/modular-decomposition/4-module-pattern.md): Types, Core/Store, Operations/Engine, Presentation/CLI layer separation.
- [Anti-Circular Dependencies](file:///packages/coding-agent/skills/architecture-and-refactoring/modular-decomposition/anti-circular-dependencies.md): Layered acyclic dependency graph, interface extraction, and mediator patterns.
- [300-Line Limit & File Splitting](file:///packages/coding-agent/skills/architecture-and-refactoring/modular-decomposition/file-size-limits.md): Physical line budgets, single runtime entity per file, and zero circular delegation.

### Pillar 2: Type Systems & Contract Preservation
- **TypeScript Specialization**:
  - [Node Strip-Only Mode (Erasable Syntax)](file:///packages/coding-agent/skills/architecture-and-refactoring/type-systems/typescript/strip-only-mode.md): No parameter properties, no enums/namespaces, explicit constructor assignments.
  - [Contract Fidelity & Zero `any`](file:///packages/coding-agent/skills/architecture-and-refactoring/type-systems/typescript/contract-fidelity.md): Eliminating `any`, branded primitives, and narrowing `unknown`.
  - [Generics & Discriminated Unions](file:///packages/coding-agent/skills/architecture-and-refactoring/type-systems/typescript/generics-and-discriminated-unions.md): Exhaustive matching, discriminant properties, and generic constraints.
- **Rust Specialization**:
  - [Newtypes & Trait Composition](file:///packages/coding-agent/skills/architecture-and-refactoring/type-systems/rust/newtype-and-traits.md): Type safety with newtypes, zero-cost abstractions, and Send/Sync invariants.
  - [Error Handling with `thiserror` & `anyhow`](file:///packages/coding-agent/skills/architecture-and-refactoring/type-systems/rust/error-handling-thiserror-anyhow.md): Library domain errors vs application context wrapping.
