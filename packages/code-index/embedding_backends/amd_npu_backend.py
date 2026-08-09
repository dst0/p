"""Facade selecting the AMD NPU implementation for the detected generation."""

from embedding_backends.amd_phoenix_iron_backend import AmdPhoenixIronBackend
from embedding_backends.amd_ryzen_ai_vitis_backend import AmdRyzenAiVitisBackend
from embedding_backends.base import BackendHealth, ModelSpec


class AmdNpuBackend:
    def __init__(self, backend_id: str, runtime_config, strict: bool = True):
        self.backend_id = backend_id
        if backend_id == "amd-phoenix-npu":
            self.delegate = AmdPhoenixIronBackend(runtime_config, strict=strict)
        elif backend_id == "amd-ryzenai-npu":
            self.delegate = AmdRyzenAiVitisBackend(runtime_config, strict=strict)
        else:
            raise ValueError(f"Unknown AMD NPU backend: {backend_id}")

    @property
    def execution_device(self) -> str:
        return self.delegate.execution_device

    @property
    def gpu_allowed(self) -> bool:
        return self.delegate.gpu_allowed

    def load(self, spec: ModelSpec) -> None:
        self.delegate.load(spec)

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        return self.delegate.encode(texts, normalize=normalize, batch_size=batch_size)

    def health(self) -> BackendHealth:
        return self.delegate.health()

    def close(self) -> None:
        self.delegate.close()
