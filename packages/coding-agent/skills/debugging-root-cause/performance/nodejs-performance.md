# Node.js / TypeScript Performance Engineering

Node.js uses a single-threaded, event-driven architecture powered by the V8 JavaScript engine and libuv. Understanding its concurrency model is critical for performance.

## 1. Event Loop Mechanics

The Node.js event loop runs in phases, processing callbacks for different types of operations:
1. **Timers:** `setTimeout`, `setInterval` callbacks.
2. **Pending Callbacks:** I/O callbacks deferred to the next loop iteration.
3. **Idle, Prepare:** Internal Node.js usage.
4. **Poll:** Retrieve new I/O events; execute I/O related callbacks.
5. **Check:** `setImmediate` callbacks.
6. **Close Callbacks:** e.g., `socket.on('close', ...)`.

**Microtasks vs. Macrotasks:**
- Microtasks (e.g., `Promise.then`, `queueMicrotask`, `process.nextTick`) are executed *immediately* after the currently executing script and *between* every event loop phase. `process.nextTick` runs before Promise microtasks.
- Excessive microtasks can starve the event loop, preventing I/O and timers from executing.

## 2. Blocking the Event Loop

Since Node.js is single-threaded, any synchronous operation blocks the entire process.
- **CPU-Bound Work:** Crypto operations (sync versions), image processing, heavy JSON parsing/stringifying, or massive loops.
- **Synchronous I/O:** `fs.readFileSync`, `child_process.execSync`. Never use these in production request paths.
- **Catastrophic Backtracking:** Poorly written Regular Expressions can take exponential time. Avoid nested quantifiers (e.g., `(a+)+`) and use libraries like `re2` if processing user-supplied regex.

## 3. Worker Threads for CPU Parallelism

For CPU-heavy tasks, offload work using `worker_threads`.

```typescript
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';

if (isMainThread) {
  const worker = new Worker(__filename, { workerData: { input: 100 } });
  worker.on('message', result => console.log(`Result: ${result}`));
} else {
  // Heavy computation here
  parentPort?.postMessage(heavyComputation(workerData.input));
}
```
*Note: Spawning workers is expensive. Use a worker pool (e.g., `piscina`) for recurring tasks.*

## 4. Memory Profiling

Memory issues manifest as high GC pause times or out-of-memory crashes.

- **Heap Snapshots:** Capture memory state.
  ```bash
  node --heapsnapshot-signal=SIGUSR2 app.js
  kill -USR2 <pid>
  ```
- **Chrome DevTools:** Run node with `--inspect`. Open `chrome://inspect` in Chrome to take heap snapshots and record allocation timelines.

## 5. Memory Leaks

Common sources of leaks in Node.js:
1. **Event Listeners:** Failing to call `removeListener`.
2. **Closure Captures:** Retaining large objects in closures that outlive their expected lifecycle.
3. **Global Variables/Caches:** Unbounded caches (always use LRU caches).

Use `WeakMap` or `WeakRef` to hold references without preventing garbage collection. `FinalizationRegistry` can execute cleanup logic when objects are garbage collected.

## 6. Stream Backpressure

When a readable stream produces data faster than a writable stream can consume it, memory balloons.
- **Backpressure:** The writable stream's `.write()` returns `false`, signaling the reader to pause. `.pipe()` handles this automatically.
- **highWaterMark:** Tunes the internal buffer size (default 16kb/64kb). Increasing it improves throughput at the cost of memory.

## 7. V8 Optimization Hints

V8 uses an optimizing compiler (TurboFan) and a fast interpreter (Ignition).
- **Monomorphic Call Sites:** Functions that always receive objects with the *same shape* (same properties in the same order) are highly optimized via Inline Caches (ICs) and Hidden Classes.
- **Hidden Classes:** V8 creates hidden classes for objects. Adding properties dynamically creates new hidden classes and deoptimizes property access.
  ```javascript
  // Bad: Dynamically adding properties
  const obj = {}; obj.x = 1; obj.y = 2;
  // Good: Initialize all properties at once
  const obj = { x: 1, y: 2 };
  ```

## 8. Benchmarking

Use `node:perf_hooks` to measure specific blocks:
```typescript
import { performance, PerformanceObserver } from 'perf_hooks';
const obs = new PerformanceObserver((list) => {
  console.log(list.getEntries()[0].duration);
});
obs.observe({ entryTypes: ['measure'] });

performance.mark('A');
// do work
performance.mark('B');
performance.measure('A to B', 'A', 'B');
```
For comparative benchmarks, use modern tools like `mitata` or `vitest bench` (which replaces older tools like Benchmark.js).
