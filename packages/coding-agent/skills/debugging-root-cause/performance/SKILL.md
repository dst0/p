---
name: performance
description: Performance engineering across Node.js, Python, and Rust. Covers profiling, memory analysis, concurrency optimization, and systematic performance debugging. Use when diagnosing slowness, memory leaks, or optimizing hot paths.
---

# Performance Engineering

Performance engineering is the systematic practice of designing, measuring, and optimizing software systems to meet speed, throughput, and resource utilization constraints. It transforms optimization from a game of guesswork into a predictable engineering discipline.

## 1. Measurement Before Optimization

"Premature optimization is the root of all evil" (Donald Knuth). Before changing any code for performance reasons:

1. **Establish a baseline:** Measure the current system performance under realistic loads using production-like data.
2. **Define success criteria:** Know what latency (e.g., P99 < 200ms) or throughput (e.g., 5000 RPS) you need to achieve.
3. **Profile to find the bottleneck:** Use tracing and profiling tools to locate the *actual* slow components, not the ones you guess are slow.
4. **Change one thing at a time:** Apply a hypothesis-driven approach. Change the code, remeasure, and keep the change only if it moved the metric toward the goal.

## 2. Amdahl's Law

Amdahl's law provides the theoretical speedup in latency of the execution of a task at fixed workload that can be expected of a system whose resources are improved.

In practice, it means: **The overall speedup of optimizing a specific part of a system is limited by the fraction of time that the system spends in that part.**

If a database query takes 10% of a request's time, optimizing that query to be infinitely fast will only speed up the request by a maximum of 10%. Always target the largest bottleneck first.

## 3. The 80/20 Rule for Hotspots (Pareto Principle)

In most software systems, 80% of the execution time is spent in 20% of the code (or even 90% in 10%). These are the "hotspots."

Profiling tools (like flame graphs) are essential for identifying this 20%. Optimizing cold paths (code that runs rarely or takes negligible time) adds complexity without providing tangible benefits. Focus your effort where it matters.

## Performance Engineering Sub-Disciplines

Explore language-specific and general optimization techniques in the following guides:

- [Node.js Performance](./nodejs-performance.md)
- [Python Performance](./python-performance.md)
- [Rust Performance](./rust-performance.md)
- [General Optimization Principles](./general-optimization.md)
