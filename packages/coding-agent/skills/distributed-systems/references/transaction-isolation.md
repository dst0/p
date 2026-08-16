# Transaction Isolation & Idempotency Registries

In high-concurrency systems, mutations must be protected by atomic rollback semantics and strict idempotency boundaries. Unhandled exceptions must never leave half-applied mutations or permanently locked idempotency keys.

---

## 1. The Atomic Transaction & Rollback Pattern

When an operation mutates in-memory state or multiple persistent records, every mutation must register an undo-action before proceeding.

```
       TRANSACTION EXECUTION FLOW
+-------------------------------------------------------+
| 1. Begin Transaction Scope                            |
|    - Snapshot initial state or prepare undo stack     |
| 2. Execute Step 1 -> Push UndoAction1 to stack        |
| 3. Execute Step 2 -> Push UndoAction2 to stack        |
| 4. Execute Step 3 -> FAILS!                           |
| 5. Catch Block -> Drain Undo Stack in LIFO Order      |
|    - Run UndoAction2                                  |
|    - Run UndoAction1                                  |
| 6. Re-throw original error with state fully restored  |
+-------------------------------------------------------+
```

### TypeScript Transaction Scope Implementation
```typescript
export class TransactionContext {
  private undoStack: Array<() => void | Promise<void>> = [];
  private committed = false;

  registerRollback(undo: () => void | Promise<void>): void {
    if (this.committed) {
      throw new Error("Cannot register rollback on committed transaction");
    }
    this.undoStack.push(undo);
  }

  commit(): void {
    this.committed = true;
    this.undoStack = [];
  }

  async rollback(): Promise<void> {
    while (this.undoStack.length > 0) {
      const undo = this.undoStack.pop()!;
      try {
        await undo();
      } catch (err) {
        console.error("Critical error during transaction rollback:", err);
      }
    }
  }
}

export async function runTransaction<T>(
  action: (tx: TransactionContext) => Promise<T>,
): Promise<T> {
  const tx = new TransactionContext();
  try {
    const result = await action(tx);
    tx.commit();
    return result;
  } catch (error) {
    await tx.rollback();
    throw error;
  }
}
```

---

## 2. Resilient Idempotency Registries

Idempotency registries track incoming operation keys to deduplicate requests. However, a naive implementation that locks a key indefinitely upon failure will block legitimate retries.

```
                   IDEMPOTENCY STATE MACHINE
                   
                   +---------------------+
                   |      NONEXISTENT    |
                   +---------------------+
                              |
                     acquire(key, lease)
                              |
                              v
                   +---------------------+
         +-------- |       PENDING       | --------+
         |         +---------------------+         |
      commit()                                   abort()
         |                                         |
         v                                         v
+---------------------+                   +---------------------+
|      COMMITTED      |                   |       RELEASED      |
| (returns cached res)|                   | (allows safe retry) |
+---------------------+                   +---------------------+
```

### Idempotency Registry Implementation
```typescript
export type IdempotencyStatus = "PENDING" | "COMMITTED";

export interface IdempotencyEntry<TResult> {
  status: IdempotencyStatus;
  expiresAt: number;
  result?: TResult;
}

export class IdempotencyRegistry<TResult> {
  private entries = new Map<string, IdempotencyEntry<TResult>>();

  /**
   * Tries to acquire lease for key. Returns cached result if already COMMITTED,
   * throws if currently PENDING, or acquires lease if new/expired.
   */
  acquire(key: string, ttlMs = 30000): { acquired: true } | { acquired: false; cached: TResult } {
    const now = Date.now();
    const existing = this.entries.get(key);

    if (existing) {
      if (existing.status === "COMMITTED") {
        return { acquired: false, cached: existing.result! };
      }
      if (existing.status === "PENDING" && existing.expiresAt > now) {
        throw new Error(`Operation for key "${key}" is currently in-flight`);
      }
    }

    this.entries.set(key, {
      status: "PENDING",
      expiresAt: now + ttlMs,
    });
    return { acquired: true };
  }

  commit(key: string, result: TResult): void {
    const existing = this.entries.get(key);
    if (!existing || existing.status !== "PENDING") {
      throw new Error(`Cannot commit non-pending idempotency key "${key}"`);
    }
    this.entries.set(key, {
      status: "COMMITTED",
      expiresAt: Number.POSITIVE_INFINITY,
      result,
    });
  }

  abort(key: string): void {
    // Release key completely on failure so retries can execute freshly
    this.entries.delete(key);
  }
}
```

---

## 3. Copy-on-Write (CoW) State Isolation

For state machines subject to concurrent reads during write operations, mutate only shallow copies and atomically swap references on commit.

```typescript
export class CopyOnWriteStateStore<TState extends Record<string, unknown>> {
  private currentState: Readonly<TState>;

  constructor(initialState: TState) {
    this.currentState = Object.freeze({ ...initialState });
  }

  getSnapshot(): Readonly<TState> {
    return this.currentState;
  }

  mutate(mutator: (draft: TState) => void): Readonly<TState> {
    const draft = { ...this.currentState };
    mutator(draft);
    this.currentState = Object.freeze(draft);
    return this.currentState;
  }
}
```
