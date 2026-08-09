"""Runtime availability and provider configuration for embedding NPUs."""

import os
import sys


def openvino_npu_available() -> bool:
    try:
        import openvino as ov

        return "NPU" in ov.Core().available_devices
    except Exception:
        return False


def onnxruntime_providers() -> list[str]:
    try:
        import onnxruntime as ort

        return list(ort.get_available_providers())
    except Exception:
        return []


def coreml_ane_available() -> bool:
    """Return whether ONNX Runtime or coremltools can execute through CoreML."""
    if sys.platform != "darwin":
        return False
    if "CoreMLExecutionProvider" in onnxruntime_providers():
        return True
    try:
        import coremltools  # noqa: F401
        import coremltools.libcoremlpython  # noqa: F401

        return True
    except Exception:
        return False


def vitisai_npu_available() -> bool:
    return "VitisAIExecutionProvider" in onnxruntime_providers()


def phoenix_iron_available() -> bool:
    if sys.platform != "linux":
        return False
    if not (os.path.exists("/dev/accel/accel0") or os.path.exists("/dev/amdxdna")):
        return False
    try:
        import aie.iron  # noqa: F401

        return True
    except Exception:
        return False


def npu_available(backend: str = "npu") -> bool:
    if backend == "npu":
        if sys.platform == "darwin":
            return coreml_ane_available()
        if sys.platform == "linux":
            return (
                phoenix_iron_available()
                or vitisai_npu_available()
                or openvino_npu_available()
            )
        return False
    if backend in {"openvino", "openvino-npu", "intel-openvino-npu"}:
        return openvino_npu_available()
    if backend == "coreml":
        return coreml_ane_available()
    if backend in {"vitisai", "ryzenai"}:
        return vitisai_npu_available()
    if backend == "amd-phoenix-npu":
        return phoenix_iron_available()
    if backend == "amd-ryzenai-npu":
        return vitisai_npu_available()
    return False


def resolve_linux_npu_backend(requested_backend: str) -> str:
    if sys.platform != "linux":
        raise RuntimeError("Linux NPU indexing backend requested on a non-Linux host")
    phoenix_available = phoenix_iron_available()
    ryzen_ai_available = vitisai_npu_available()
    intel_available = openvino_npu_available()
    if requested_backend == "amd-phoenix-npu":
        if phoenix_available:
            return requested_backend
        raise RuntimeError(
            "AMD Phoenix/Hawk Point requested, but MLIR-AIE/IRON npu1 is unavailable"
        )
    if requested_backend == "amd-ryzenai-npu":
        if ryzen_ai_available:
            return requested_backend
        raise RuntimeError(
            "AMD STX/KRK requested, but Ryzen AI 1.8 VitisAIExecutionProvider is unavailable"
        )
    if requested_backend in {"openvino", "openvino-npu", "intel-openvino-npu"}:
        if intel_available:
            return "openvino"
        raise RuntimeError("Intel OpenVINO does not expose an NPU device")
    if requested_backend in {"vitisai", "ryzenai"}:
        if phoenix_available:
            return "amd-phoenix-npu"
        if ryzen_ai_available:
            return "amd-ryzenai-npu"
        raise RuntimeError("No validated AMD NPU runtime is available")
    if requested_backend != "npu":
        raise ValueError(f"Unsupported Linux NPU backend: {requested_backend}")
    amd_backends = [
        backend
        for backend, available in (
            ("amd-phoenix-npu", phoenix_available),
            ("amd-ryzenai-npu", ryzen_ai_available),
        )
        if available
    ]
    if amd_backends and intel_available:
        raise RuntimeError(
            "Both AMD and Intel NPU runtimes are available; select an explicit backend"
        )
    if len(amd_backends) == 1:
        return amd_backends[0]
    if intel_available:
        return "openvino"
    raise RuntimeError("No validated AMD or Intel Linux NPU runtime is available")


def vitisai_provider_options(
    model_name: str,
    *,
    cache_dir: str,
    cache_key: str | None = None,
    config_file: str | None = None,
    log_level: str = "error",
) -> dict[str, str]:
    if config_file and not os.path.exists(config_file):
        raise RuntimeError(f"Vitis AI config file does not exist: {config_file}")
    os.makedirs(cache_dir, exist_ok=True)
    options = {
        "cache_dir": cache_dir,
        "cache_key": cache_key or model_name.replace("/", "_"),
        "log_level": log_level,
    }
    if config_file:
        options["config_file"] = config_file
    return options
