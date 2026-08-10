"""Observed real-model embedding throughput for health telemetry."""


class EmbeddingPerformanceTracker:
    """Accumulates multi-vector encode performance for the active backend."""

    def __init__(self):
        self.reset(None)

    def reset(self, backend: str | None):
        self.backend = backend
        self.vectors = 0
        self.seconds = 0.0
        self.last_vectors_per_second: float | None = None

    def record(self, backend: str, vectors: int, seconds: float):
        if vectors <= 1 or seconds <= 0:
            return
        if backend != self.backend:
            self.reset(backend)
        self.vectors += vectors
        self.seconds += seconds
        self.last_vectors_per_second = vectors / seconds

    def snapshot(self) -> dict[str, float | int | str | None]:
        average = self.vectors / self.seconds if self.seconds > 0 else None
        return {
            "backend": self.backend,
            "vectors": self.vectors,
            "seconds": round(self.seconds, 3),
            "vectorsPerSecond": round(average, 2) if average is not None else None,
            "lastVectorsPerSecond": (
                round(self.last_vectors_per_second, 2)
                if self.last_vectors_per_second is not None
                else None
            ),
        }

