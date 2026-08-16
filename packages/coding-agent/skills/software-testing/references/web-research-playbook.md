# Web Research Playbook for Unknown Frameworks & APIs

When testing code using third-party APIs, SDKs, or unfamiliar frameworks, perform thorough research rather than guessing behavior or types.

---

## 1. Official Documentation & Source Verification
1. Inspect `node_modules` typings (`.d.ts`) directly to confirm function signatures, options, and error types.
2. Search repository history for existing test harnesses and mocking fixtures.
3. Check changelogs for breaking changes between major versions (e.g., Vitest v3 -> v4, Node 20 -> 22).

---

## 2. Dynamic Discovery
- Inspect runtime symbol types via Node REPL or diagnostic test files.
- Validate behavior by constructing minimal reproduction fixtures.
