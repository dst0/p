"""PyTorch reference backend for CPU, NVIDIA CUDA, and AMD ROCm."""

import sys
from typing import Any
from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash


class PyTorchBackend:
    """PyTorch reference backend for CPU, NVIDIA CUDA, and AMD ROCm."""

    def __init__(self, backend_id: str = "cpu", strict: bool = False):
        self.backend_id = backend_id
        self.strict = strict
        self.execution_device = "cpu"
        self.gpu_allowed = backend_id in {"nvidia-cuda", "amd-rocm", "apple-mps"}
        self.model: Any = None
        self.spec: ModelSpec = ModelSpec()
        self.fallback_occurred = False
        self.fallback_reason: str | None = None

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        import torch
        from sentence_transformers import SentenceTransformer

        target_device = "cpu"
        if self.backend_id == "nvidia-cuda":
            if not torch.cuda.is_available():
                msg = "NVIDIA CUDA requested but torch.cuda is not available"
                if self.strict:
                    raise RuntimeError(msg)
                self.fallback_occurred = True
                self.fallback_reason = msg
                target_device = "cpu"
            else:
                target_device = "cuda"
        elif self.backend_id == "amd-rocm":
            is_rocm = getattr(torch.version, "hip", None) is not None
            if not (torch.cuda.is_available() and is_rocm):
                msg = "AMD ROCm requested but ROCm/HIP is not available"
                if self.strict:
                    raise RuntimeError(msg)
                self.fallback_occurred = True
                self.fallback_reason = msg
                target_device = "cpu"
            else:
                target_device = "cuda"
        elif self.backend_id == "apple-mps":
            if not (sys.platform == "darwin" and torch.backends.mps.is_available()):
                msg = "Apple MPS requested but PyTorch MPS is not available"
                if self.strict:
                    raise RuntimeError(msg)
                self.fallback_occurred = True
                self.fallback_reason = msg
                target_device = "cpu"
            else:
                target_device = "mps"

        self.execution_device = target_device
        self.model = SentenceTransformer(spec.model_name, device=target_device)

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        if self.model is None:
            raise RuntimeError("PyTorchBackend model not loaded")

        embeddings = self.model.encode(
            texts,
            normalize_embeddings=normalize,
            batch_size=batch_size,
            show_progress_bar=False,
        )
        if hasattr(embeddings, "tolist"):
            return embeddings.tolist()
        return [list(vec) for vec in embeddings]

    def health(self) -> BackendHealth:
        tok_hash = compute_tokenizer_hash(self.spec.model_name)
        compat_group = compute_compatibility_group(
            self.spec.model_name,
            self.spec.dimensions,
            self.spec.pooling,
            self.spec.normalization,
        )
        return BackendHealth(
            status="ready" if self.model is not None else "loading",
            requested_backend=self.backend_id,
            selected_backend=self.backend_id if not self.fallback_occurred else "cpu",
            execution_device=self.execution_device,
            gpu_allowed=self.gpu_allowed,
            fallback_occurred=self.fallback_occurred,
            fallback_reason=self.fallback_reason,
            model_name=self.spec.model_name,
            dimensions=self.spec.dimensions,
            tokenizer_hash=tok_hash,
            pooling=self.spec.pooling,
            normalization=self.spec.normalization,
            compatibility_group=compat_group,
        )

    def close(self) -> None:
        self.model = None
