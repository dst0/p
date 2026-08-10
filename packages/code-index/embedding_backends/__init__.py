"""Embedding backend abstraction layer for hardware-aware code indexing."""

from embedding_backends.base import BackendHealth, EmbeddingBackend, ModelSpec
from embedding_backends.health import format_backend_health
from embedding_backends.model_contract import compute_compatibility_group, compute_model_artifact_hash, compute_tokenizer_hash
from embedding_backends.registry import resolve_backend, resolve_legacy_backend_id

__all__ = [
    "EmbeddingBackend",
    "ModelSpec",
    "BackendHealth",
    "resolve_backend",
    "resolve_legacy_backend_id",
    "compute_compatibility_group",
    "compute_tokenizer_hash",
    "compute_model_artifact_hash",
    "format_backend_health",
]
