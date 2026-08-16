---
name: software-testing-typescript
description: "Comprehensive test engineering guide for TypeScript runtimes: Node.js test runner (v20-v22), Vitest (v4 default and v1-v3 compat), and Jest ESM."
---

# TypeScript Test Engineering Guide

This sub-skill provides deep operational patterns, configuration strategies, and troubleshooting guides for testing TypeScript and JavaScript applications across modern test runners.

---

## Supported Runners & Matrix

| Runner | Versions | Default / Recommended | Status |
| :--- | :--- | :--- | :--- |
| **Vitest** | v4.x+ | Yes (Default) | Full ESM, Worker Threads, V8 Coverage |
| **Vitest Legacy** | v1.x–v3.x | Compatibility tier | Pool config adjustments, migration shims |
| **Node.js Native** | Node 20–22+ | Zero-dependency | Built-in `node:test` and `node:assert` |
| **Jest Modern** | v29+ | Legacy/Enterprise | Native ESM `--experimental-vm-modules` |

---

## Detailed Navigation

- [Vitest Modern v4+ (Default)](file:///packages/coding-agent/skills/software-testing/languages/typescript/vitest/default-v4.md): Modern threading, mock hoisting, snapshot serialization, and isolated in-process testing.
- [Vitest Legacy v1–v3 Compatibility](file:///packages/coding-agent/skills/software-testing/languages/typescript/vitest/v1-v3-compat.md): Migration caveats, pool configurations (`threads` vs `forks`), and mock breaking changes.
- [Node.js Native Test Runner (v20–v22)](file:///packages/coding-agent/skills/software-testing/languages/typescript/node-test/v20-v22.md): Built-in `node:test`, subtest contexts, mock timers, and top-level await.
- [Jest Native ESM](file:///packages/coding-agent/skills/software-testing/languages/typescript/jest/modern-esm.md): Running Jest in pure ESM mode with ts-jest or babel-jest.
