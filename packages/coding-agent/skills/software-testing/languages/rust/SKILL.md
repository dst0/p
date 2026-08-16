---
name: software-testing-rust
description: "Rust test engineering guide: Cargo test harnesses, integration tests, proptest invariant fuzzing, and deterministic crash verification."
---

# Rust Test Engineering Guide

This sub-skill provides standard conventions, property-based testing patterns, and invariant verification protocols for Rust systems and libraries.

---

## 1. Directory & File Organization

Rust separates tests into two primary locations:
- **Unit Tests**: In-file `#[cfg(test)] mod tests { ... }` alongside private implementations.
- **Integration Tests**: In the root `tests/` directory as separate compilation crates testing the public API.

---

## 2. Navigation

- [Cargo Test Integration](file:///packages/coding-agent/skills/software-testing/languages/rust/cargo-test.md): Multi-threaded execution, `--test-threads=1`, `should_panic`, ignored tests, and doc-tests.
- [Proptest Invariants & Shrinking](file:///packages/coding-agent/skills/software-testing/languages/rust/proptest-invariants.md): Generative testing with `proptest`, state machine invariants, and test-case shrinking.
