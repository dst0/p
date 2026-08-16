# Anti-Circular Dependencies & Decoupling

Circular dependencies (`A -> B -> A`) cause undefined runtime imports, memory leaks, and brittle initialization order.

---

## 1. Strategies for Breaking Circularities

1. **Extract Shared Contracts**: Move mutual interfaces or types into a lower-tier `types.ts` file.
2. **Dependency Inversion**: Pass callbacks, event emitters, or interfaces rather than importing concrete classes.
3. **Mediator / Coordinator Pattern**: Introduce a higher-level orchestrator that coordinates both modules without them importing each other.

```typescript
// Antipattern: Direct circular import
// Session -> ToolRunner -> Session

// Solution: Dependency Inversion via Callback or Context
export interface ToolExecutionContext {
  readonly sessionId: string;
  sendMessage(msg: string): Promise<void>;
}

export class ToolRunner {
  async execute(tool: string, ctx: ToolExecutionContext): Promise<void> {
    await ctx.sendMessage(`Executing ${tool}`);
  }
}
```
