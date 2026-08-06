"""Base types, data structures, and protocol definitions for embedding backends."""

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class ModelSpec:
    model_name: str = "Qwen/Qwen3-Embedding-0.6B"
    dimensions: int = 1024
    sequence_length: int = 2048
    pooling: str = "last-non-padding-token"
    normalization: str = "l2"
    query_instruction_version: str = "qwen3-v1"
    document_format_version: str = "v1"


@dataclass
class BackendHealth:
    status: str  # "ready", "loading", "error", "degraded"
    requested_backend: str
    selected_backend: str
    execution_device: str
    gpu_allowed: bool
    fallback_occurred: bool
    fallback_reason: str | None = None
    model_name: str = "Qwen/Qwen3-Embedding-0.6B"
    dimensions: int = 1024
    model_revision: str = "main"
    tokenizer_hash: str = ""
    pooling: str = "last-non-padding-token"
    normalization: str = "l2"
    compatibility_group: str = "qwen3-embedding-0.6b-1024-last-token-v1"
    batch_size: int = 8
    extra: dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class EmbeddingBackend(Protocol):
    backend_id: str
    execution_device: str
    gpu_allowed: bool

    def load(self, spec: ModelSpec) -> None:
        ...

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        ...

    def health() -> BackendHealth:
        ...

    def close(self) -> None:
        ...
