# Node.js Strip-Only Mode & Erasable TypeScript Syntax

Node.js v22.6.0+ natively executes TypeScript by stripping types. This requires strictly **erasable syntax** (syntax that can be erased to produce valid JS without code generation).

---

## 1. Forbidden Constructs in Strip-Only Mode

| Forbidden Construct | Reason | Modern Replacement |
| :--- | :--- | :--- |
| **`enum Foo { A, B }`** | Requires runtime object emit | String union `type Foo = "a" \| "b"` or `as const` object |
| **`constructor(public x: string)`** | Requires property assignment emit | Explicit field: `x: string; constructor(x: string) { this.x = x; }` |
| **`namespace Foo { ... }`** | Requires closure emit | ES modules `import` / `export` |
| **`import = require()`** | Legacy TS syntax | Standard ES `import x from "x"` |

---

## 2. Constructor Best Practice

```typescript
// Forbidden in strip-only mode:
// class BadService { constructor(public readonly id: string) {} }

// Compliant:
export class GoodService {
  readonly id: string;
  readonly createdAt: number;

  constructor(id: string) {
    this.id = id;
    this.createdAt = Date.now();
  }
}
```
