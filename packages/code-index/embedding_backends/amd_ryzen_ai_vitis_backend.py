"""Ryzen AI 1.8 Vitis AI backend for STX/KRK NPUs."""

import os
from dataclasses import replace
from typing import Any

from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.onnx_embedding_wrapper import ONNXEmbeddingWrapper
from embedding_npu_runtime import vitisai_provider_options


class AmdRyzenAiVitisBackend:
    backend_id = "amd-ryzenai-npu"
    execution_device = "AMD STX/KRK npu2 (Vitis AI)"
    gpu_allowed = True

    def __init__(self, runtime_config, strict: bool = True):
        self.runtime_config = runtime_config
        self.strict = strict
        self.model: Any = None
        self.spec = ModelSpec()
        self.model_validated = False

    def load(self, spec: ModelSpec) -> None:
        import onnxruntime as ort
        from optimum.onnxruntime import ORTModelForFeatureExtraction
        from transformers import AutoConfig, AutoTokenizer

        self.spec = spec
        if "VitisAIExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError("Ryzen AI 1.8 did not expose VitisAIExecutionProvider")
        session_options = ort.SessionOptions()
        session_options.enable_cpu_mem_arena = False
        session_options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
        session_options.log_severity_level = _log_severity(
            self.runtime_config.vitisai_log_level
        )
        provider_options = vitisai_provider_options(
            spec.model_name,
            cache_dir=self.runtime_config.vitisai_cache_directory,
            cache_key=self.runtime_config.vitisai_cache_key,
            config_file=self.runtime_config.vitisai_config_file,
        )
        repository = (
            "onnx-community/Qwen3-Embedding-0.6B-ONNX"
            if spec.model_name == "Qwen/Qwen3-Embedding-0.6B"
            else spec.model_name
        )
        cache_dir = os.path.expanduser(
            f"~/.p/agent/indexing-service/onnx-cache/{spec.model_name.replace('/', '_')}"
        )
        config = AutoConfig.from_pretrained(repository)
        config.use_cache = False
        tokenizer = AutoTokenizer.from_pretrained(repository)
        source = cache_dir if os.path.exists(os.path.join(cache_dir, "model.onnx")) else repository
        ort_model = ORTModelForFeatureExtraction.from_pretrained(
            source,
            export=False,
            provider="VitisAIExecutionProvider",
            provider_options=provider_options,
            session_options=session_options,
            config=config,
        )
        providers = list(ort_model.model.get_providers())
        if not providers or providers[0] != "VitisAIExecutionProvider":
            raise RuntimeError(f"Ryzen AI session selected unexpected providers: {providers}")
        self.model = ONNXEmbeddingWrapper(
            ort_model,
            tokenizer,
            device_name=self.execution_device,
            model_name=spec.model_name,
            dimensions=spec.dimensions,
            requested_backend=self.backend_id,
            selected_backend=self.backend_id,
            provider="VitisAIExecutionProvider",
            allow_runtime_cpu_fallback=False,
        )
        self.model.max_seq_length = spec.sequence_length
        self.model.encode(["NPU validation probe"], batch_size=1)
        self.model_validated = True

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        if self.model is None or not self.model_validated:
            raise RuntimeError("Ryzen AI embedding model is not validated")
        result = self.model.encode(
            texts,
            normalize_embeddings=normalize,
            batch_size=batch_size,
            show_progress_bar=False,
        )
        return result.tolist() if hasattr(result, "tolist") else list(result)

    def health(self) -> BackendHealth:
        if self.model is None:
            return BackendHealth(
                status="loading",
                requested_backend=self.backend_id,
                selected_backend=self.backend_id,
                execution_device=self.execution_device,
                gpu_allowed=True,
                fallback_occurred=False,
            )
        health = self.model.health()
        return replace(
            health,
            selected_backend=self.backend_id,
            execution_device=self.execution_device,
            extra={
                **health.extra,
                "deviceGeneration": "npu2",
                "modelValidated": self.model_validated,
                "runtimeFamily": "ryzen-ai-vitis",
                "runtimeVersion": self.runtime_config.amd_npu_runtime_version,
            },
        )

    def close(self) -> None:
        self.model = None
        self.model_validated = False


def _log_severity(value: str) -> int:
    return {"verbose": 0, "info": 1, "warning": 2, "error": 3, "fatal": 4}.get(
        value.lower(), 3
    )
