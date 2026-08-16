# Cancellation and Timeouts

Proper lifecycle management ensures systems do not leak resources, hang indefinitely, or continue processing work that is no longer needed.

## Cancellation Mechanisms by Language

### Node.js / Web (JavaScript / TypeScript)
*   **AbortController & AbortSignal:** The standard way to cancel async operations (fetch requests, streams, custom logic).
    ```typescript
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    try {
        const response = await fetch('/api/data', { signal: controller.signal });
        // ...
    } catch (e) {
        if (e.name === 'AbortError') {
            console.log('Request timed out');
        }
    } finally {
        clearTimeout(timeoutId);
    }
    ```

### Python (asyncio)
*   **`asyncio.CancelledError`:** When a task is cancelled (`task.cancel()`), it raises an `asyncio.CancelledError` at its next `await` point.
*   **Shielding:** Use `asyncio.shield()` to protect a critical operation from being cancelled if the parent task is cancelled.
    ```python
    try:
        await asyncio.sleep(10)
    except asyncio.CancelledError:
        print("Task was cancelled")
        # Perform cleanup
        raise # ALWAYS re-raise CancelledError unless you have a very specific reason not to
    ```

### Rust (Tokio)
*   **Drop on Cancel:** Rust handles cancellation by dropping the `Future`. There is no "cancellation exception" like in Python.
*   **`tokio::select!`:** Runs multiple futures concurrently. When one completes, the others are instantly dropped (cancelled).
    ```rust
    tokio::select! {
        res = fetch_data() => println!("Data: {:?}", res),
        _ = tokio::time::sleep(Duration::from_secs(5)) => println!("Timeout!"),
    }
    ```
*   **Cancellation Safety:** Ensure operations within a `select!` are cancellation-safe (e.g., reading from a channel).

### Go (for comparison)
*   **`context.Context`:** Passed down the call stack. Used for cancellation signals, deadlines, and request-scoped values.

## Timeout Patterns

Never make a network call or acquire a lock without a timeout.

*   **JS/TS:** `Promise.race([fetchTask, new Promise((_, r) => setTimeout(() => r(new Error('Timeout')), 1000))])` (though `AbortSignal.timeout()` is preferred now).
*   **Python:** `asyncio.wait_for(task, timeout=5.0)`
*   **Rust:** `tokio::time::timeout(Duration::from_secs(5), future)`

## Graceful Shutdown

When an application receives a termination signal (SIGTERM/SIGINT), it should not crash immediately. Orchestrate a graceful shutdown:

1.  **Stop accepting new work:** Stop the HTTP server listener, stop reading from Kafka.
2.  **Drain existing work:** Wait for active requests to finish (with an overarching timeout).
3.  **Flush buffers:** Ensure all metrics, logs, and batch DB writes are flushed.
4.  **Close connections:** Close DB pools, disconnect from message brokers.

## Resource Cleanup

Always ensure resources (file handles, network sockets, DB connections) are released regardless of success, failure, or cancellation.

*   **JS/TS:** `finally` blocks.
*   **Python:** `finally` blocks, `async with` context managers.
*   **Rust:** The `Drop` trait automatically cleans up resources when they go out of scope.
