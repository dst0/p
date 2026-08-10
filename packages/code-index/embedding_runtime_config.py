"""Typed embedding runtime settings loaded from code-rag.json."""

import json
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class EmbeddingRuntimeConfig:
    embedding_model: str = "Qwen/Qwen3-Embedding-0.6B"
    device: str = "auto"
    max_embedding_batch_size: int = 64
    max_cpu_threads: int = os.cpu_count() or 1
    max_sequence_length: int = 2048
    min_system_memory_reserve_bytes: int = 1024 * 1024 * 1024
    min_accelerator_memory_reserve_bytes: int = 512 * 1024 * 1024
    model_parameter_count: int | None = None
    openvino_cache_directory: str = os.path.expanduser(
        "~/.p/agent/indexing-service/openvino-cache"
    )
    amd_iron_artifact_directory: str = os.path.expanduser(
        "~/.p/agent/indexing-service/amd-phoenix-iron/artifacts"
    )
    amd_iron_cache_directory: str = os.path.expanduser(
        "~/.p/agent/indexing-service/amd-phoenix-iron/cache"
    )
    amd_iron_source_directory: str = os.path.expanduser(
        "~/.p/agent/indexing-service/amd-phoenix-iron/mlir-aie"
    )
    amd_npu_generation: str | None = None
    amd_npu_runtime_version: str | None = None
    vitisai_cache_directory: str = os.path.expanduser(
        "~/.p/agent/indexing-service/vitisai-cache"
    )
    vitisai_cache_key: str | None = None
    vitisai_config_file: str | None = None
    vitisai_log_level: str = "error"


def config_path_from_arguments(arguments: list[str]) -> str | None:
    try:
        index = arguments.index("--config")
    except ValueError:
        return None
    if index + 1 >= len(arguments):
        raise ValueError("--config requires a path")
    return arguments[index + 1]


def load_embedding_runtime_config(config_path: str | None) -> EmbeddingRuntimeConfig:
    if not config_path:
        return EmbeddingRuntimeConfig()
    with open(config_path, encoding="utf-8") as config_file:
        raw = json.load(config_file)
    if not isinstance(raw, dict):
        raise ValueError(f"Invalid code indexing config at {config_path}: expected an object")
    return EmbeddingRuntimeConfig(
        embedding_model=_string(raw, "embeddingModel", "Qwen/Qwen3-Embedding-0.6B"),
        device=_string(raw, "embeddingDevice", "auto"),
        max_embedding_batch_size=_positive_int(raw, "maxEmbeddingBatchSize", 64),
        max_cpu_threads=_positive_int(raw, "maxCpuThreads", os.cpu_count() or 1),
        max_sequence_length=_positive_int(raw, "maxSequenceLength", 2048),
        min_system_memory_reserve_bytes=_positive_int(
            raw, "minSystemMemoryReserveBytes", 1024 * 1024 * 1024
        ),
        min_accelerator_memory_reserve_bytes=_positive_int(
            raw, "minAcceleratorMemoryReserveBytes", 512 * 1024 * 1024
        ),
        model_parameter_count=_optional_positive_int(raw, "embeddingModelParameterCount"),
        openvino_cache_directory=_string(
            raw,
            "openvinoCacheDirectory",
            os.path.expanduser("~/.p/agent/indexing-service/openvino-cache"),
        ),
        amd_iron_artifact_directory=_string(
            raw,
            "amdIronArtifactDirectory",
            os.path.expanduser(
                "~/.p/agent/indexing-service/amd-phoenix-iron/artifacts"
            ),
        ),
        amd_iron_cache_directory=_string(
            raw,
            "amdIronCacheDirectory",
            os.path.expanduser("~/.p/agent/indexing-service/amd-phoenix-iron/cache"),
        ),
        amd_iron_source_directory=_string(
            raw,
            "amdIronSourceDirectory",
            os.path.expanduser("~/.p/agent/indexing-service/amd-phoenix-iron/mlir-aie"),
        ),
        amd_npu_generation=_optional_string(raw, "amdNpuGeneration"),
        amd_npu_runtime_version=_optional_string(raw, "amdNpuRuntimeVersion"),
        vitisai_cache_directory=_string(
            raw,
            "vitisaiCacheDirectory",
            os.path.expanduser("~/.p/agent/indexing-service/vitisai-cache"),
        ),
        vitisai_cache_key=_optional_string(raw, "vitisaiCacheKey"),
        vitisai_config_file=_optional_string(raw, "vitisaiConfigFile"),
        vitisai_log_level=_string(raw, "vitisaiLogLevel", "error"),
    )


def _positive_int(raw: dict, key: str, default: int) -> int:
    value = raw.get(key, default)
    if not isinstance(value, int) or isinstance(value, bool) or value < 1:
        raise ValueError(f"{key} must be a positive integer")
    return value


def _optional_positive_int(raw: dict, key: str) -> int | None:
    if key not in raw:
        return None
    return _positive_int(raw, key, 1)


def _string(raw: dict, key: str, default: str) -> str:
    value = raw.get(key, default)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{key} must be a non-empty string")
    return value


def _optional_string(raw: dict, key: str) -> str | None:
    if key not in raw:
        return None
    return _string(raw, key, "")
