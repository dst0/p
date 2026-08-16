---
name: framework-ecosystems-nodejs
description: "Node.js ecosystem guide: Modern Node.js (v22-v26) native TypeScript stripping, SQLite, WebSockets, and Node.js v20 LTS baseline."
---

# Node.js Ecosystem Guide

This sub-skill provides standard conventions, performance patterns, and version-specific guidance for modern Node.js environments.

---

## 1. Version Matrix

| Version Tier | Status | Default | Key Features |
| :--- | :--- | :--- | :--- |
| **Node.js v22–v26+** | Current / Active LTS | Yes (Default) | Native TS type stripping (`--experimental-strip-types`), built-in `node:sqlite`, native WebSocket, `module.register`. |
| **Node.js v20 LTS** | Maintenance LTS | Compatibility | Stable `fetch`, stable `node:test`, crypto Web Crypto API, permission model flags. |

---

## 2. Direct Navigation

- [Node.js v22–v26 Modern (Default)](file:///packages/coding-agent/skills/framework-ecosystems/nodejs/v22-v26-modern.md)
- [Node.js v20 LTS Compatibility](file:///packages/coding-agent/skills/framework-ecosystems/nodejs/v20-lts.md)
