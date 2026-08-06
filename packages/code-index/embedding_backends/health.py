"""Health reporting utilities for embedding backends."""

from typing import Any
from embedding_backends.base import BackendHealth


def format_backend_health(health: BackendHealth) -> dict[str, Any]:
    """Format BackendHealth data dataclass to JSON-serializable dictionary."""
    return {
        "status": health.status,
        "requestedBackend": health.requested_backend,
        "selectedBackend": health.selected_backend,
        "executionDevice": health.execution_device,
        "gpuAllowed": health.gpu_allowed,
        "fallbackOccurred": health.fallback_occurred,
        "fallbackReason": health.fallback_reason,
        "model": health.model_name,
        "dimensions": health.dimensions,
        "modelRevision": health.model_revision,
        "tokenizerHash": health.tokenizer_hash,
        "pooling": health.pooling,
        "normalization": health.normalization,
        "compatibilityGroup": health.compatibility_group,
        "batchSize": health.batch_size,
        **health.extra,
    }
