# Synchronization Primitives

Coordination tools are necessary to protect shared state from race conditions and to signal between concurrent tasks.

## Core Primitives

*   **Mutex (Mutual Exclusion):** Ensures only one thread/task can access a resource at a time.
*   **RwLock (Read-Write Lock):** Allows multiple concurrent readers OR one exclusive writer. Optimizes for read-heavy workloads.
*   **Semaphore:** Maintains a counter. Allows up to *N* threads/tasks to access a resource concurrently. Useful for connection pools or rate limiting.
*   **Condition Variable:** Allows threads to wait until a specific condition becomes true, avoiding busy-waiting.

## Language Implementations

### JavaScript / Node.js
Since JS is single-threaded, you usually don't need mutexes for protecting memory variables. However, you *do* need them for protecting external asynchronous resources or multi-step async transactions.
*   **Workers & Shared Memory:** When using `Worker` threads and `SharedArrayBuffer`, you must use the `Atomics` API (e.g., `Atomics.wait`, `Atomics.add`) to safely manipulate shared memory.

### Python
Python has separate primitives for threads vs. async tasks vs. processes.
*   **Threads:** `threading.Lock`, `threading.RLock`, `threading.Semaphore`.
*   **Asyncio:** `asyncio.Lock` (protects async state from context switching between `await` points).
*   **Multiprocessing:** `multiprocessing.Lock` (backed by OS-level semaphores for inter-process locking).

### Rust
Rust enforces thread-safety at compile time via the `Send` and `Sync` traits.
*   **Std (Blocking):** `std::sync::Mutex`, `std::sync::RwLock`. Blocks the OS thread.
*   **Tokio (Async):** `tokio::sync::Mutex`, `tokio::sync::RwLock`. Yields the current task without blocking the underlying thread.
*   **Channels:** Rust heavily favors message passing over shared state.
    *   `mpsc` (Multi-Producer, Single-Consumer): Sending work to a single worker.
    *   `broadcast`: One sender, many receivers.
    *   `watch`: Stores a single value, notifies receivers when it changes.
    *   `oneshot`: Send a single value once (like returning a result from a background task).

## Preventing Deadlocks

A deadlock occurs when two or more tasks are waiting on each other indefinitely.
1.  **Lock Ordering:** Always acquire multiple locks in the exact same order across all tasks.
2.  **Timeouts:** Use `try_lock` or acquire locks with a timeout to detect and recover from deadlocks.
3.  **Minimize Lock Scope:** Hold locks for the shortest possible duration. Never hold a lock during an I/O operation (like a network request).

## Lock-Free Patterns

Instead of using heavy OS-level locks, lock-free programming relies on atomic CPU instructions.
*   **Atomic Variables:** (e.g., `AtomicI32` in Rust). Safe to read/write across threads without a lock.
*   **Compare-And-Swap (CAS):** An atomic operation that updates a value only if it hasn't been changed by another thread since we last read it. Forms the basis of lock-free data structures.
