"""Benchmark script for hardware-aware embedding backends in P agent."""

import argparse
import json
import math
import sys
import time

from embedding_backends import (
    ModelSpec,
    resolve_backend,
)

BENCHMARK_CORPUS = [
    "def calculate_vector_similarity(query_vector, document_vector): return sum(a*b for a,b in zip(query_vector, document_vector))",
    "export interface CodeIndexManifest { repository: string; compatibilityGroup: string; vectorsCount: number; }",
    "pub struct VectorStore { points: Vec<Point>, dimension: usize } impl VectorStore { pub fn search(&self) {} }",
    "import Foundation\npublic final class ANEEmbeddingModel { public func encode() -> [[Float]] {} }",
    "# Background daemon service worker loop handling ongoing filesystem events and debounce indexing queue",
    "SELECT * FROM embeddings WHERE cosine_distance(vector, :query) < 0.15 ORDER BY distance ASC LIMIT 10;",
    "class EmbeddingServerManager extends SubprocessLifecycleManager { async ensureReady() {} }",
    "const batchSize = Math.max(1, this.options.batchSize ?? 8);",
]


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


def run_benchmark(backend_id: str, iterations: int = 10, batch_size: int = 8) -> dict:
    backend = resolve_backend(backend_id, strict=False)
    spec = ModelSpec(model_name="Qwen/Qwen3-Embedding-0.6B", dimensions=1024)
    backend.load(spec)

    # Warmup
    backend.encode(BENCHMARK_CORPUS[:2], batch_size=batch_size)

    latencies = []
    total_vectors = 0
    start_total = time.perf_counter()

    for _ in range(iterations):
        t0 = time.perf_counter()
        vecs = backend.encode(BENCHMARK_CORPUS, batch_size=batch_size)
        t1 = time.perf_counter()
        latencies.append((t1 - t0) * 1000.0)  # ms
        total_vectors += len(vecs)

    total_time = time.perf_counter() - start_total
    latencies.sort()

    p50 = latencies[len(latencies) // 2]
    p95 = latencies[int(len(latencies) * 0.95)]
    throughput = total_vectors / total_time if total_time > 0 else 0

    health = backend.health()
    backend.close()

    return {
        "backend_id": backend_id,
        "selected_backend": health.selected_backend,
        "execution_device": health.execution_device,
        "fallback_occurred": health.fallback_occurred,
        "iterations": iterations,
        "total_vectors": total_vectors,
        "total_time_sec": round(total_time, 3),
        "vectors_per_sec": round(throughput, 2),
        "latency_p50_ms": round(p50, 2),
        "latency_p95_ms": round(p95, 2),
    }


def main():
    parser = argparse.ArgumentParser(description="Benchmark code-index embedding backends.")
    parser.add_argument("--backends", nargs="+", default=["apple-ane", "cpu"], help="Backends to benchmark")
    parser.add_argument("--iterations", type=int, default=5, help="Number of benchmark iterations")
    parser.add_argument("--batch-size", type=int, default=8, help="Batch size")
    args = parser.parse_args()

    results = []
    for backend_id in args.backends:
        try:
            res = run_benchmark(backend_id, iterations=args.iterations, batch_size=args.batch_size)
            results.append(res)
        except Exception as e:
            results.append({"backend_id": backend_id, "error": str(e)})

    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
