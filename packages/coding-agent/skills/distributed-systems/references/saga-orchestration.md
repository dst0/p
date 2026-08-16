# Saga Orchestration, Lease Fencing & Inverse Compensation

Complex multi-step distributed operations must preserve global consistency without relying on long-lived database locks. Sagas achieve this through directed acyclic graph (DAG) scheduling, monotonic lease fencing, and inverse compensating workflows.

---

## 1. Directed Acyclic Graph (DAG) Task Orchestration

A saga coordinates discrete steps with explicit dependency graphs. Steps without mutual dependencies execute concurrently within bounded concurrency pools.

```
          [ Step A: Reserve Funds ]
                      |
        +-------------+-------------+
        |                           |
        v                           v
[ Step B: Allocate Disk ]   [ Step C: Provision Network ]
        |                           |
        +-------------+-------------+
                      |
                      v
          [ Step D: Launch Container ]
```

### Topological Execution with Reverse Compensation
If Step D fails, the orchestrator triggers compensating actions for already-completed nodes in reverse topological order:
`Compensate C -> Compensate B -> Compensate A`.

```typescript
export interface SagaStep<TContext> {
  id: string;
  dependencies: string[];
  execute: (ctx: TContext) => Promise<void>;
  compensate: (ctx: TContext) => Promise<void>;
}

export class SagaOrchestrator<TContext> {
  private executedSteps: SagaStep<TContext>[] = [];

  async run(steps: SagaStep<TContext>[], context: TContext): Promise<void> {
    this.executedSteps = [];

    try {
      for (const step of steps) {
        await step.execute(context);
        this.executedSteps.push(step);
      }
    } catch (error) {
      await this.rollback(context);
      throw error;
    }
  }

  private async rollback(context: TContext): Promise<void> {
    // Reverse topological compensation
    const toCompensate = [...this.executedSteps].reverse();
    for (const step of toCompensate) {
      try {
        await step.compensate(context);
      } catch (compensationError) {
        // Log critical failure to dead-letter queue; compensation must not throw uncaught
        console.error(`Compensation failed for step ${step.id}:`, compensationError);
      }
    }
  }
}
```

---

## 2. Monotonic Lease Fencing & Zombie Prevention

In distributed environments, a delayed or stalled worker process must not wake up after its lease has expired and overwrite fresh state (split-brain/zombie hazard).

```
Worker 1 (Lease Token = 101) --------[ GC Pause / Stalled ]-------------> Tries write (REJECTED: 101 < 102)
                                                |
Worker 2 (Lease Token = 102) --- Acquires Lease & Writes State (Token = 102)
```

### Lease Fencing Invariant
Every state store update must include a monotonically incrementing fence token. If the store's current token $\ge \text{request token}$, the write is rejected with `FenceTokenExpiredException`.

```typescript
export class FencedStateStore<T> {
  private currentFenceToken = 0;
  private state: T;

  constructor(initialState: T) {
    this.state = initialState;
  }

  acquireLease(): number {
    return ++this.currentFenceToken;
  }

  commitUpdate(fenceToken: number, updater: (prev: T) => T): void {
    if (fenceToken < this.currentFenceToken) {
      throw new Error(`Write rejected: Fence token ${fenceToken} is stale. Current token is ${this.currentFenceToken}`);
    }
    this.state = updater(this.state);
  }
}
```

---

## 3. Exponential Backoff with Full Jitter

When retrying transient operations, fixed delays or linear backoff cause thundering herd synchronization spikes. Full jitter randomizes delays across the exponential envelope:

$$\text{Delay} = \text{random}(0, \min(\text{maxDelay}, \text{baseDelay} \times 2^{\text{attempt}}))$$

```typescript
export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export async function executeWithFullJitter<T>(
  operation: (attempt: number) => Promise<T>,
  options: RetryOptions,
  signal?: AbortSignal,
): Promise<T> {
  let attempt = 0;

  while (true) {
    if (signal?.aborted) {
      throw new Error("Operation aborted");
    }

    try {
      return await operation(attempt);
    } catch (error) {
      attempt++;
      if (attempt >= options.maxRetries) {
        throw error;
      }

      const exponentialLimit = Math.min(
        options.maxDelayMs,
        options.baseDelayMs * Math.pow(2, attempt),
      );
      // Full jitter: uniformly distributed between 0 and exponential limit
      const sleepMs = Math.floor(Math.random() * exponentialLimit);

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, sleepMs);
        signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("Operation aborted during backoff"));
          },
          { once: true },
        );
      });
    }
  }
}
```

---

## 4. Virtual Time & Deterministic Simulation Testing

To test distributed sagas, race conditions, and exponential backoffs without waiting minutes in real time, use deterministic discrete-event virtual clocks.

```typescript
export class VirtualClock {
  private currentTime = 0;
  private scheduledEvents: { time: number; callback: () => void }[] = [];

  now(): number {
    return this.currentTime;
  }

  setTimeout(callback: () => void, delayMs: number): void {
    this.scheduledEvents.push({ time: this.currentTime + delayMs, callback });
    this.scheduledEvents.sort((a, b) => a.time - b.time);
  }

  advance(ms: number): void {
    const target = this.currentTime + ms;
    while (this.scheduledEvents.length > 0 && this.scheduledEvents[0].time <= target) {
      const next = this.scheduledEvents.shift()!;
      this.currentTime = next.time;
      next.callback();
    }
    this.currentTime = target;
  }
}
```
