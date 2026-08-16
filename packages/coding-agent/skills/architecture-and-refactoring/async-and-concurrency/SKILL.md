---
name: async-and-concurrency
description: Async/await patterns, cancellation, synchronization primitives, and concurrency pitfalls across TypeScript, Python, and Rust. Use when implementing async workflows, managing timeouts, or debugging race conditions.
---

# Async and Concurrency

Concurrency is one of the most error-prone areas in software engineering. Correctly orchestrating multiple sequences of operations—especially when they share resources or depend on I/O—requires a solid understanding of different concurrency models and synchronization primitives.

## The Fundamental Difference: Concurrency vs. Parallelism

*   **Concurrency** is about **dealing** with a lot of things at once. It's a program structure. You decompose a program into independently executing tasks.
*   **Parallelism** is about **doing** a lot of things at once. It's an execution model. You execute multiple tasks simultaneously on multiple CPU cores.

A concurrent program can run on a single core (by interleaving execution), whereas parallelism strictly requires multiple hardware execution units.

## Concurrency Models

### Shared-Memory vs. Message-Passing

1.  **Shared-Memory Concurrency**
    *   Multiple threads or tasks read and write to the same memory locations.
    *   **Pros:** Fast, minimal overhead when accessing data.
    *   **Cons:** Requires careful synchronization (mutexes, locks) to prevent race conditions and data corruption. High risk of deadlocks.
    *   *Examples:* Java threads, C++ `std::thread`, Rust `std::sync::Mutex`.
2.  **Message-Passing Concurrency**
    *   Tasks do not share memory. Instead, they communicate by sending messages to each other over channels.
    *   "Do not communicate by sharing memory; instead, share memory by communicating." (Go Proverb)
    *   **Pros:** Easier to reason about ownership and state. Fewer explicit locks.
    *   **Cons:** Overhead of copying or moving data through channels. Can still suffer from deadlocks if channel buffers are full and send/receives are cyclic.
    *   *Examples:* Go channels, Rust `mpsc` (Multi-Producer, Single-Consumer), Erlang/Elixir actors.

### Cooperative vs. Preemptive Multitasking

1.  **Cooperative Multitasking**
    *   Tasks must explicitly yield control (e.g., via `await`, `yield`) to allow other tasks to run.
    *   **Pros:** Lower overhead (no OS context switching for tasks). You know exactly where a context switch can occur, which can simplify some synchronization needs.
    *   **Cons:** A CPU-bound task that forgets to yield (e.g., a long `while` loop) will block the entire event loop, starving all other tasks.
    *   *Examples:* Node.js event loop, Python `asyncio`, Rust `tokio`.
2.  **Preemptive Multitasking**
    *   The operating system or runtime scheduler forcefully pauses tasks and switches to others at regular intervals (time-slicing).
    *   **Pros:** Fair scheduling. A single greedy thread cannot freeze the whole system.
    *   **Cons:** Higher overhead. Context switches can happen between *any* two machine instructions, making race conditions harder to spot and requiring strict synchronization.
    *   *Examples:* OS-level threads (pthreads), Go goroutines.

## Sub-Topics

Explore specific concurrency topics and language implementations:

*   [Async/Await Patterns](./async-await-patterns.md): Language-specific async constructs and common pitfalls.
*   [Cancellation and Timeouts](./cancellation-and-timeouts.md): Lifecycle management and preventing hung tasks.
*   [Synchronization Primitives](./synchronization-primitives.md): Mutexes, locks, and coordination tools.
*   [Common Pitfalls](./common-pitfalls.md): Real-world concurrency bugs and how to avoid them.
