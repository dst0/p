# Discriminated Unions & Generic Constraints

Discriminated unions enable exhaustive pattern matching and type-safe state modeling.

---

## 1. Discriminated Union Pattern

```typescript
export type AgentState =
  | { status: "uninitialized" }
  | { status: "idle"; lastActiveAt: number }
  | { status: "running"; taskId: string; startedAt: number }
  | { status: "errored"; error: Error; canRetry: boolean };

export function formatAgentStatus(state: AgentState): string {
  switch (state.status) {
    case "uninitialized":
      return "Not started";
    case "idle":
      return `Idle since ${new Date(state.lastActiveAt).toISOString()}`;
    case "running":
      return `Running task ${state.taskId}`;
    case "errored":
      return `Failed: ${state.error.message}`;
    default: {
      // Exhaustiveness check: compile-time error if a variant is unhandled
      const _exhaustive: never = state;
      throw new Error(`Unhandled state: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
```

---

## 2. Constrained Generics

```typescript
export interface Identifiable {
  readonly id: string;
}

export class EntityIndex<T extends Identifiable> {
  private map = new Map<string, T>();

  add(entity: T): void {
    this.map.set(entity.id, entity);
  }

  get(id: string): T | undefined {
    return this.map.get(id);
  }
}
```
