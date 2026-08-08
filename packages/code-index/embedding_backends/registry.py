"""Backend registry for hardware-aware backend selection and migration."""

import sys
from embedding_backends.base import EmbeddingBackend
from embedding_backends.onnx_backend import ONNXBackend
from embedding_backends.openvino_backend import OpenVINOBackend
from embedding_backends.torch_backend import PyTorchBackend


def resolve_legacy_backend_id(raw: str) -> str:
    """
    Migrate legacy backend identifiers to explicit hardware-aware identifiers.

    - "npu" on macOS arm64 -> "apple-mps"
    - "npu" on Linux -> remains hardware-auto-detected by the embedding server
    - "cuda" -> "nvidia-cuda"
    - "rocm" -> "amd-rocm"
    - "mps"  -> "apple-mps"
    """
    clean = str(raw).strip().lower()
    if clean == "npu":
        if sys.platform == "darwin":
            return "apple-mps"
        return "npu"
    if clean == "cuda":
        return "nvidia-cuda"
    if clean == "rocm":
        return "amd-rocm"
    if clean == "mps":
        return "apple-mps"
    if clean in {"auto", ""}:
        if sys.platform == "darwin":
            return "apple-mps"
        try:
            import torch
            if torch.cuda.is_available():
                if getattr(torch.version, "hip", None) is not None:
                    return "amd-rocm"
                return "nvidia-cuda"
        except Exception:
            pass
        return "cpu"
    return clean


def resolve_backend(backend_id: str, strict: bool = False) -> EmbeddingBackend:
    """Instantiate and return an EmbeddingBackend for the given explicit backend identifier."""
    resolved_id = resolve_legacy_backend_id(backend_id)

    if resolved_id == "apple-ane":
        return PyTorchBackend("apple-mps", strict=strict)
    if resolved_id in {"nvidia-cuda", "amd-rocm", "apple-mps"}:
        return PyTorchBackend(resolved_id, strict=strict)
    if resolved_id in {"intel-openvino-cpu", "intel-openvino-npu"}:
        return OpenVINOBackend(resolved_id, strict=strict)
    if resolved_id == "onnx-cpu":
        return ONNXBackend(resolved_id, strict=strict)

    return PyTorchBackend("cpu", strict=strict)
