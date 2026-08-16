# Contract Fidelity & Zero `any` Principle

Using `any` defeats the type system and introduces silent runtime defects. Contract fidelity demands exact, narrow types.

---

## 1. Zero `any` Rules

1. **Replace `any` with `unknown`**: When data originates from an external source (JSON, network, user input), type it as `unknown` and validate with type guards or schemas before use.
2. **Branded Types for Identifiers**: Prevent accidental mixing of IDs (e.g. `UserId` vs `SessionId`):

```typescript
export type Brand<K, T> = K & { readonly __brand: T };

export type SessionId = Brand<string, "SessionId">;
export type TaskId = Brand<string, "TaskId">;

export function asSessionId(raw: string): SessionId {
  if (!raw.startsWith("sess_")) throw new Error("Invalid SessionId format");
  return raw as SessionId;
}
```

---

## 2. Type Narrowing with User-Defined Type Guards

```typescript
export interface DiagnosticError {
  type: "error";
  code: string;
  message: string;
}

export function isDiagnosticError(value: unknown): value is DiagnosticError {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "error" &&
    typeof (value as Record<string, unknown>).message === "string"
  );
}

---

## 3. Idiomatic Collection Signatures (Direct Arrays vs Envelopes)

When designing methods that accept or process collections/batches:

### Direct Return Principle (Homogeneous Mapping)
When a function processes a batch or collection of inputs `T[]`, its natural, idiomatic return type is the direct array of output results `R[]` (analogous to `Array.prototype.map` or `Promise.all`):
```typescript
// Idiomatic: Direct array mapping preserving index correspondence and array methods
processOrders(orders: OrderRequest[]): OrderConfirmation[];

// Anti-Pattern: Gratuitous single-property container object
processOrders(orders: OrderRequest[]): { results: OrderConfirmation[] };
```

### When to Use Envelopes
Only wrap array results in an object envelope when **heterogeneous metadata** must accompany the collection:
- Cursor / Offset Pagination: `{ data: R[], nextCursor: string, totalCount: number }`
- Partial Failure Envelopes: `{ succeeded: R[], failed: Array<{ item: T; error: Error }> }`
- Protocol Metadata: `{ payload: R[], schemaVersion: number, latencyMs: number }`

When no accompanying metadata is defined, avoid artificial wrapping. Callers expect direct arrays to support `.length`, indexing, destructuring, and iterator protocols without indirection.

```
