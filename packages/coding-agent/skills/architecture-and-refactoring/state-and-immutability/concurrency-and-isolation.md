# Concurrency and Isolation

When multiple threads, processes, or distributed nodes interact with shared state, careful isolation is required to maintain consistency and prevent race conditions, deadlocks, and tearing.

## Primitives and Locking (Pessimistic Concurrency)

Pessimistic concurrency assumes contention will happen and uses locks to guarantee exclusive access.

* **Mutex (Mutual Exclusion)**: Guarantees only one thread can access the data at a time.
* **RwLock (Read-Write Lock)**: Allows multiple concurrent readers, but exclusive access for a writer. Useful for read-heavy workloads.
* **Language Specifics**:
  * **Java**: `synchronized` keyword provides intrinsic reentrant mutexes.
  * **Python**: The Global Interpreter Lock (GIL) prevents concurrent execution of Python bytecodes in CPython, though standard library `threading.Lock` is still required for application-level data structures.
  * **Rust**: `Mutex<T>` and `RwLock<T>` wrap the data they protect. You cannot access the data without holding the lock, preventing accidental lock bypass.

*Drawbacks*: Deadlocks, priority inversion, and high contention bottlenecks.

## Compare-and-Swap (Optimistic Concurrency)

Optimistic concurrency assumes contention is rare. It proceeds with a mutation and verifies nothing changed before committing.

**Compare-and-Swap (CAS)** is an atomic CPU instruction. It updates a memory location only if its current value matches an expected value. 
Used extensively in building lock-free data structures (e.g., `java.util.concurrent.ConcurrentHashMap`) and highly concurrent counters.

```java
AtomicInteger counter = new AtomicInteger(0);
// Loops until the CAS operation succeeds
int prev, next;
do {
    prev = counter.get();
    next = prev + 1;
} while (!counter.compareAndSet(prev, next));
```

## Shared-Nothing Architectures and the Actor Model

Instead of threads sharing memory and using locks, execution units encapsulate their own private state and communicate exclusively via message passing. 

* **The Actor Model**: Actors are primitives of concurrent computation. An actor receives messages, mutates its private state, and sends messages to other actors.
* **Examples**: Erlang/Elixir (OTP), Akka (JVM/Scala).

This avoids locks entirely at the application level. State is completely isolated. Scaling out across a network becomes conceptually identical to scaling across CPU cores.

## Multi-Version Concurrency Control (MVCC)

Used heavily by databases (PostgreSQL, InnoDB in MySQL) to avoid read-locks blocking writes.

Instead of overwriting data in place, updates create a new version of the row. 
* Readers read the version of the data that was valid when their transaction started (Snapshot Isolation).
* Writers append new versions. 
* Background processes (vacuuming/compaction) clean up obsolete versions once no active transactions need them.

This maps closely to the concepts of immutable data structures, applied at the storage layer, ensuring high throughput and strict isolation.
