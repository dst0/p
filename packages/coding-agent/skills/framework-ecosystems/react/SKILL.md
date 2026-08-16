---
name: framework-ecosystems-react
description: "React ecosystem guide: React 19 modern features (Actions, use, React Compiler, ref as prop) and React 18 compatibility."
---

# React Ecosystem Guide

This sub-skill provides architectural conventions, hook lifecycle patterns, and version nuances for React applications.

---

## 1. Version Matrix

| Version Tier | Status | Default | Key Features |
| :--- | :--- | :--- | :--- |
| **React 19** | Modern | Yes (Default) | Server Actions, `use()` hook, direct `ref` props (no `forwardRef`), asset preloading, `useActionState`. |
| **React 18** | Compatibility | Legacy Tier | `startTransition`, `useId`, Suspense boundaries, SSR streaming architecture. |

---

## 2. Direct Navigation

- [React 19 Modern Architecture (Default)](file:///packages/coding-agent/skills/framework-ecosystems/react/v19-modern.md)
- [React 18 Compatibility & Patterns](file:///packages/coding-agent/skills/framework-ecosystems/react/v18-compat.md)
