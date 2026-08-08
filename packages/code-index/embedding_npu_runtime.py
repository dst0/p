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


def npu_available(backend: str = "npu") -> bool:
    if backend == "npu":
        if sys.platform == "darwin":
            return coreml_ane_available()
        if sys.platform == "linux":
            return vitisai_npu_available() or openvino_npu_available()
        return False
    if backend in {"openvino", "openvino-npu", "intel-openvino-npu"}:
        return openvino_npu_available()
    if backend == "coreml":
        return coreml_ane_available()
    if backend in {"vitisai", "ryzenai"}:
        return vitisai_npu_available()
    return False


def vitisai_provider_options(model_name: str) -> dict[str, str]:
    config_file = os.environ.get("P_CODE_RAG_VITISAI_CONFIG_FILE")
    if config_file and not os.path.exists(config_file):
        raise RuntimeError(f"Vitis AI config file does not exist: {config_file}")
    cache_dir = os.environ.get(
        "P_CODE_RAG_VITISAI_CACHE_DIR",
        os.path.expanduser("~/.p/agent/indexing-service/vitisai-cache"),
    )
    os.makedirs(cache_dir, exist_ok=True)
    options = {
        "cache_dir": cache_dir,
        "cache_key": os.environ.get(
            "P_CODE_RAG_VITISAI_CACHE_KEY", model_name.replace("/", "_")
        ),
        "log_level": os.environ.get("P_CODE_RAG_VITISAI_LOG_LEVEL", "error"),
    }
    if config_file:
        options["config_file"] = config_file
    return options
