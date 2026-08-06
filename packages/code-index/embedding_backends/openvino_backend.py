"""OpenVINO backend for Intel CPU and NPU inference."""

from typing import Any
from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash


class OpenVINOBackend:
    """OpenVINO backend for Intel CPU and NPU inference."""

    def __init__(self, backend_id: str = "intel-openvino-cpu", strict: bool = False):
        self.backend_id = backend_id
        self.strict = strict
        self.execution_device = "Intel OpenVINO CPU"
        self.gpu_allowed = False
        self.model: Any = None
        self.spec: ModelSpec = ModelSpec()
        self.fallback_occurred = False
        self.fallback_reason: str | None = None

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        device = "NPU" if "npu" in self.backend_id.lower() else "CPU"
        self.execution_device = f"Intel OpenVINO {device}"

        try:
            from optimum.intel import OVSentenceTransformer
            self.model = OVSentenceTransformer.from_pretrained(spec.model_name, device=device)
        except Exception as error:
            msg = f"OpenVINO load failed for device {device}: {error}"
            if self.strict:
                raise RuntimeError(msg) from error
            self.fallback_occurred = True
            self.fallback_reason = msg
            from sentence_transformers import SentenceTransformer
            self.execution_device = "PyTorch CPU (Fallback)"
            self.model = SentenceTransformer(spec.model_name, device="cpu")

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        if self.model is None:
            raise RuntimeError("OpenVINOBackend model not loaded")

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
