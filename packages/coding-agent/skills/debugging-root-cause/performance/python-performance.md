# Python Performance Engineering

Python prioritizes developer velocity over raw execution speed. However, with careful architecture and profiling, Python applications can achieve excellent performance.

## 1. The Global Interpreter Lock (GIL)

The GIL is a mutex that protects access to Python objects, preventing multiple native threads from executing Python bytecodes simultaneously in CPython.
- **I/O-Bound Work:** Threads are excellent. The GIL is released during I/O operations (network, disk).
- **CPU-Bound Work:** Threads provide *zero* parallel speedup for pure Python code. Use `multiprocessing` instead.

*(Note: PEP 703 aims to make the GIL optional in future Python versions, but the architectural principles remain relevant).*

## 2. Concurrency Models

Choose the right tool for the job:
- **`asyncio`**: Best for massive I/O concurrency (thousands of connections, WebSockets). Uses a single-threaded event loop. Prefer `aiohttp` or `httpx` for async HTTP over `requests`.
- **`concurrent.futures.ThreadPoolExecutor`**: Good for concurrent synchronous I/O (e.g., legacy DB drivers).
- **`concurrent.futures.ProcessPoolExecutor` / `multiprocessing`**: Necessary for parallel CPU-bound work. IPC (Inter-Process Communication) adds overhead; batch data to minimize serialization costs.

## 3. Profiling Tools

Never guess where Python is slow. Profile.
- **cProfile:** Built-in deterministic profiler. Good for overall function call counts and cumulative time.
  ```bash
  python -m cProfile -o profile.stats script.py
  ```
- **line_profiler:** Invaluable for line-by-line CPU timing within a specific function.
- **py-spy:** A sampling profiler that can profile running processes without modifying code (low overhead). Perfect for generating flame graphs:
  ```bash
  py-spy record -o profile.svg --pid <PID>
  ```
- **memory_profiler / memray:** Use `memray` for modern, accurate memory profiling and leak detection.

## 4. Vectorization (NumPy / Pandas)

Loops in Python are notoriously slow due to interpreter overhead and dynamic typing.
For numerical or data manipulation tasks, push the loop down into optimized C/Fortran code using NumPy.

```python
import numpy as np
# SLOW (Python loop):
# result = [x * 2 for x in data]

# FAST (Vectorized C loop):
arr = np.array(data)
result = arr * 2
```

## 5. Dropping to Lower Levels (Hot Paths)

When algorithmic optimization isn't enough for a CPU hotspot:
- **Cython:** Compile Python-like code to C extensions.
- **Numba:** JIT compiler for numerical Python. Add `@njit` to functions working with NumPy arrays.
- **PyO3 (Rust):** Write highly safe, concurrent, and blazingly fast extensions in Rust and expose them to Python.

## 6. Memory Management

Python uses reference counting and a generational garbage collector (for cyclic references).
- **`__slots__`:** If you instantiate millions of objects, normal Python classes store attributes in a dynamic dictionary (`__dict__`). Defining `__slots__` statically allocates space, saving significant memory and slightly improving attribute access time.
  ```python
  class Point:
      __slots__ = ['x', 'y']
      def __init__(self, x, y):
          self.x = x
          self.y = y
  ```
- **`weakref`:** Use weak references to build caches without preventing objects from being garbage collected.
- **Generators:** Use generators (`yield`) instead of returning large lists to keep memory usage flat.
