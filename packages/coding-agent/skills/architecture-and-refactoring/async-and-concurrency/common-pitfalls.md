# Common Pitfalls and Concurrency Bugs

Concurrency bugs are notorious for being non-deterministic, hard to reproduce, and causing severe production incidents.

## 1. Race Conditions in Read-Modify-Write
Occurs when multiple tasks read a value, compute a new value, and write it back concurrently.
*   **Example:** Two concurrent requests try to increment a user's balance from $10 to $11. Both read $10, both add $1, both write $11. One increment is lost.
*   **Fix:** Use atomic operations, database transactions (e.g., `UPDATE users SET balance = balance + 1`), or Mutexes.

## 2. Thundering Herd (Cache Stampede)
A highly requested cache key expires. Suddenly, hundreds of concurrent requests find a cache miss and all simultaneously query the database to compute the value, crushing the DB.
*   **Fix:**
    *   **Promise Coalescing (Singleflight):** If a computation is already in progress, subsequent requests attach to the existing promise instead of starting a new one.
    *   **Mutex:** Only allow one thread to recalculate, while others wait for the cache to be populated.

## 3. Connection Pool Exhaustion
Starting unbounded concurrent tasks that each require a database connection will quickly exhaust the connection pool, leading to timeouts or failures.
*   **Fix:** Use Semaphores to limit concurrency, or bounded worker pools.

## 4. Unbounded Queues and Backpressure
If a producer generates messages faster than a consumer can process them, an unbounded queue will grow until the system runs out of memory (OOM crash).
*   **Fix:** Apply backpressure. Use bounded queues that block or return errors to the producer when full, forcing the producer to slow down.

## 5. Priority Inversion
A low-priority task holds a lock needed by a high-priority task. A medium-priority task preempts the low-priority task, effectively delaying the high-priority task indefinitely.
*   **Fix:** Avoid mixing locks across tasks of different priorities, or use OS/Runtime features that support priority inheritance.

## 6. Starvation and Livelock
*   **Starvation:** A task never gets a chance to run because other tasks continuously take the resources (e.g., readers constantly acquiring an RwLock, starving a writer).
*   **Livelock:** Two tasks continually change their state in response to each other to resolve a conflict, but neither makes progress (like two people trying to pass each other in a hallway, both stepping in the same direction).

## Debugging Techniques

Concurrency bugs rarely reproduce locally. You must rely on telemetry and runtime inspection.

1.  **Thread Dumps:** In Java or Rust/C, taking a thread dump during a hang will reveal which thread holds which lock, immediately identifying deadlocks.
2.  **Async Stack Traces:** Node.js and Python can capture async stack traces, helping trace the origin of a suspended promise/coroutine.
3.  **Correlation IDs:** Every log line must include a request/correlation ID. When 100 requests are interleaved in the logs, you cannot debug a failure without filtering by a unique ID.
4.  **Logging State Transitions:** Log when a task acquires a lock, when it releases it, and when it starts waiting.
