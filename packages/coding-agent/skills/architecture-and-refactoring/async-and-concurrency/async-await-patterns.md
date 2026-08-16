# Async/Await Patterns

While async/await syntax looks similar across languages, the underlying execution models and best practices differ significantly.

## JavaScript / TypeScript

JS uses a single-threaded, non-blocking event loop (cooperative multitasking).

*   **Promises:** The foundation. A state machine (Pending, Fulfilled, Rejected).
*   **Combinators:**
    *   `Promise.all()`: Fails fast if *any* promise rejects. Use for dependent tasks.
    *   `Promise.allSettled()`: Waits for all to finish, regardless of success. Use for independent tasks (e.g., sending 3 emails).
    *   `Promise.race()`: Returns the first to settle (resolve or reject). Often used for timeouts.
    *   `Promise.any()`: Returns the first to *resolve*.
*   **Microtask Queue:** `.then()` and `await` continuations go into the microtask queue, which drains entirely before the event loop continues to the next macro-task (like `setTimeout`).

### Common JS Pitfalls
1.  **The `async forEach` Trap:**
    `array.forEach(async (item) => { await process(item) })` does *not* await the callbacks sequentially. It fires them all off concurrently.
    *Fix:* Use `for...of` for sequential, or `Promise.all(array.map(...))` for concurrent.
2.  **Unhandled Rejections:** Always attach a `.catch()` or use `try/catch` around `await`.
3.  **Fire-and-Forget:** Calling an async function without awaiting it can lead to silent failures and unhandled rejections if it throws.
4.  **Async Constructors:** Constructors cannot be async. Use a static `async create()` factory method instead.

## Python

Python's `asyncio` provides cooperative multitasking on a single thread.

*   **Tasks vs. Coroutines:** Calling `async def foo()` returns a coroutine object; it doesn't run until awaited or wrapped in an `asyncio.Task` (via `asyncio.create_task()`).
*   **TaskGroups (Python 3.11+):** The modern, safe way to run concurrent tasks. If one task fails, the `TaskGroup` cancels all other running tasks in the group.
    ```python
    async with asyncio.TaskGroup() as tg:
        task1 = tg.create_task(fetch_data(1))
        task2 = tg.create_task(fetch_data(2))
    # All tasks are guaranteed done/cancelled when the block exits
    ```
*   **`asyncio.gather`:** The older method. If a task raises an exception, others keep running in the background unless explicitly cancelled, leading to orphaned tasks.

### Common Python Pitfalls
1.  **Blocking the Event Loop:** Running CPU-bound code (like `time.sleep()`, heavy JSON parsing, or sync DB calls) in an `async` function freezes the loop. Use `asyncio.to_thread()` or an executor for blocking calls.

## Rust

Rust's `async/await` is based on zero-cost abstractions and lazy execution.

*   **Futures are Lazy:** An `async` function returns a `Future`. It does absolutely nothing until it is polled (usually by `.await`ing it).
*   **Runtimes:** Rust doesn't have a built-in async runtime. You must use a crate like `tokio` or `async-std`.
*   **Pinning (`Pin` / `Unpin`):** Because async blocks can contain references across yield points (`.await`), they must not move in memory. `Pin` guarantees the memory won't move.
*   **Cancellation Safety:** In Rust, a Future is cancelled by simply dropping it (stopping polling). A function is "cancellation safe" if dropping it halfway through doesn't leave the system in an invalid state. `tokio::select!` cancels futures this way.

### Common Rust Pitfalls
1.  **Holding a Mutex guard across `.await`:** If you acquire a standard library `std::sync::Mutex` and then `.await`, the future might be yielded to another thread, but the mutex is tied to the current thread, causing deadlocks or panics.
    *Fix:* Use `tokio::sync::Mutex` if you must hold it across an await, or (better) drop the guard before awaiting.
