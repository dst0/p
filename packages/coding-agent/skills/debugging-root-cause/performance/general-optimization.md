# General Optimization Principles

Regardless of language, system architecture and algorithmic choices dominate performance outcomes.

## 1. Algorithmic Complexity (Big O)

Choosing the right data structure is the most impactful optimization.
- **O(1) Hash Maps:** Use maps/sets for lookups instead of scanning arrays O(N).
- **O(log N) Trees:** Use balanced trees or binary search when ordered data is needed.
- Even O(N log N) (sorting) can be too slow for millions of items on a hot path.

*Caveat: Constant factors matter. For small N (e.g., N < 50), a linear scan of a cache-friendly array is often faster than an O(1) hash map lookup due to hashing overhead and cache misses.*

## 2. Caching Strategies

Avoid doing work that has already been done.
- **Memoization:** Caching the result of pure functions based on their inputs.
- **LRU (Least Recently Used):** Prevents memory exhaustion by evicting older entries.
- **Write-Through vs. Write-Back:** Write-through updates the cache and DB synchronously (safer). Write-back updates the cache and asynchronously updates the DB (lower latency).
- **Cache Invalidation:** "There are only two hard things in Computer Science: cache invalidation and naming things." Use TTLs or event-driven invalidation.

## 3. Connection Pooling

TCP handshakes, TLS negotiation, and database authentication are expensive (often >100ms).
- **Databases:** Always use connection pools (e.g., PgBouncer, HikariCP) to maintain persistent connections to the database.
- **HTTP/Keep-Alive:** Reuse HTTP connections to downstream services.

## 4. Lazy Evaluation and Deferred Computation

Do work only when necessary.
- **Pagination:** Don't load 10,000 rows if the user only sees 50.
- **Background Jobs:** If an operation doesn't need to block the HTTP response (e.g., sending a welcome email, generating a PDF), push it to a background queue (Celery, BullMQ, SQS).

## 5. Compression Trade-offs

Trading CPU cycles for network/disk I/O.
- **gzip:** Ubiquitous, standard HTTP compression.
- **brotli:** Better compression ratios for text (HTML/JS/CSS), slightly slower to compress.
- **zstd:** Extremely fast compression and decompression, excellent for internal RPC or database storage.
*Rule of thumb:* Compress text over network. Do not compress already compressed data (images, video) or very small payloads where CPU overhead exceeds network savings.

## 6. Load Testing

You cannot validate performance without simulating production traffic.
- **k6:** Modern, scriptable in JS, excellent for complex user flows.
- **wrk / wrk2:** High performance, C-based HTTP benchmarking. Great for raw RPS limits.
- **locust:** Python-based, good for distributed, stateful user simulation.

## 7. Flame Graph Interpretation

Flame graphs are the universal language of performance profiling.
- **X-axis:** Represents population (time on CPU or memory allocated). Wider boxes = more time. *It does not represent chronological time.*
- **Y-axis:** Represents the call stack. The base is the entry point, climbing up to the leaf functions.
- **How to read:** Look for wide plateaus (plateaus at the top mean a specific function is dominating; plateaus lower down mean a specific call path is expensive).
