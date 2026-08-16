# Rust Performance Engineering

Rust is designed for extreme performance with memory safety. It compiles to optimized machine code via LLVM. Most performance work in Rust involves helping the compiler do its job or optimizing memory layouts.

## 1. Zero-Cost Abstractions

Rust's core philosophy is that abstractions shouldn't impose runtime overhead.
- **Iterators:** Often compile down to loops that are as fast or faster than manual `for` or `while` loops, heavily optimized via loop unrolling and vectorization.
- **Generics:** Monomorphized at compile time. `fn foo<T>(x: T)` generates unique machine code for every type `T` used, eliminating dynamic dispatch overhead (unlike trait objects `dyn Trait`).

## 2. Allocation Strategies

Heap allocations (`Box`, `Vec`, `String`) require expensive system calls and cause memory fragmentation.
- **Stack Allocation:** Prefer passing by reference or keeping small data on the stack.
- **SmallVec / TinyVec:** If a `Vec` usually contains a small number of elements, use `SmallVec` to keep it on the stack, spilling to the heap only when necessary.
- **Arena Allocators:** For graphs or ASTs where many objects share lifetimes, use an arena (e.g., `bumpalo`) to allocate everything in one fast block and deallocate it simultaneously.

## 3. Profiling Tools

Rust uses standard system-level profilers.
- **perf (Linux):** The gold standard for profiling CPU cycles, cache misses, and branch mispredictions.
- **cargo-flamegraph:** Generates intuitive flame graphs easily.
  ```bash
  cargo flamegraph --bin my_app
  ```
- **Criterion:** The standard library for micro-benchmarking, offering statistical analysis to detect regressions.

## 4. Cache-Friendly Data Structures (SoA vs. AoS)

Modern CPUs fetch data from memory into caches (L1/L2/L3) in chunks (cache lines, typically 64 bytes). Unused data in a cache line wastes memory bandwidth.

- **AoS (Array of Structs):** `Vec<Particle>` where `struct Particle { pos: Vec3, vel: Vec3, color: Color }`. Updating only `pos` loads unused `vel` and `color` data into the cache.
- **SoA (Struct of Arrays):** `struct Particles { pos: Vec<Vec3>, vel: Vec<Vec3>, color: Vec<Color> }`. Updating `pos` is highly cache-efficient and easier for LLVM to auto-vectorize (SIMD).

## 5. Async Runtime Tuning (Tokio)

`tokio` is the dominant async runtime.
- **Worker Threads:** By default, tokio spawns one thread per CPU core.
- **Blocking Work:** NEVER perform blocking I/O or heavy CPU work inside a `tokio::spawn` async task. This stalls the worker thread and starves other tasks. Use `tokio::task::spawn_blocking` to offload it to a dedicated thread pool.
- **Task Budgeting:** Tokio implements cooperative scheduling. If an async loop runs indefinitely without yielding (e.g., awaiting), it forces the task to yield periodically to maintain fairness.

## 6. Binary Size Optimization

Smaller binaries load faster and fit better in instruction caches.
In `Cargo.toml`:
```toml
[profile.release]
opt-level = "z"     # Optimize for size
lto = true          # Link Time Optimization (cross-crate optimizations)
codegen-units = 1   # Better optimization at the cost of compile time
strip = true        # Strip symbols
```

## 7. SIMD and Auto-Vectorization

LLVM auto-vectorizes simple loops. For explicit control, use `std::simd` (portable SIMD) to process multiple data elements in a single CPU instruction (e.g., AVX2, NEON). Ensure code is compiled for the target CPU architecture: `RUSTFLAGS="-C target-cpu=native" cargo build --release`.
