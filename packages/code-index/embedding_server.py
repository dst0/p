#!/usr/bin/env python3
"""
Local embedding server for code-index.

Uses sentence-transformers to run Qwen3-Embedding-0.6B on CPU, CUDA,
ROCm, or Metal with resource-aware batching.

Usage:
    python embedding_server.py [--port 18742] [--model Qwen/Qwen3-Embedding-0.6B]

API:
    POST /embed
    Body: {"input": ["text1", "text2"], "normalize": true}
    Response: {"model": "...", "dim": 1024, "embeddings": [[...], [...]]}

    GET /health
    Response: {"status": "ready", "model": "...", "resource_plan": {...}}
"""

import argparse
import json
import os
import sys
import threading
import time
import traceback
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn

from embedding_runtime_config import (
    EmbeddingRuntimeConfig,
    config_path_from_arguments,
    load_embedding_runtime_config,
)

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
_startup_runtime_config = load_embedding_runtime_config(
    config_path_from_arguments(sys.argv[1:])
)
if _startup_runtime_config.device == "cpu":
    os.environ["CUDA_VISIBLE_DEVICES"] = "99"
    os.environ["HIP_VISIBLE_DEVICES"] = "99"
    os.environ["ROCR_VISIBLE_DEVICES"] = "99"

try:
    import torch
    from sentence_transformers import SentenceTransformer
except ImportError:
    print(
        "ERROR: sentence-transformers not installed.\n"
        "  pip install sentence-transformers transformers torch",
        file=sys.stderr,
    )
    sys.exit(1)

from resource_manager import (
    GIB,
    MemorySnapshot,
    RuntimePlan,
    build_runtime_plan,
    estimate_model_parameter_count,
    system_memory_snapshot,
)
from embedding_backends.onnx_embedding_wrapper import (
    EMBEDDING_NORMALIZATION,
    EMBEDDING_POOLING,
    ONNXEmbeddingWrapper,
    last_token_pool_np as _last_token_pool_np,
)
from embedding_npu_runtime import (
    coreml_ane_available as _coreml_ane_available,
    npu_available as _npu_available,
    onnxruntime_providers as _onnxruntime_providers,
    openvino_npu_available as _openvino_npu_available,
    vitisai_npu_available as _vitisai_npu_available,
    vitisai_provider_options as _vitisai_provider_options,
)


def get_current_rss_mb() -> float:
    """Return the current process RSS memory in megabytes."""
    try:
        import psutil
        return psutil.Process(os.getpid()).memory_info().rss / 1024 / 1024
    except Exception:
        pass
    try:
        import resource
        rusage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform == "darwin":
            return rusage / 1024 / 1024
        return rusage / 1024
    except Exception:
        return 0.0


class EmbeddingServer:
    def __init__(
        self,
        model_name: str = "Qwen/Qwen3-Embedding-0.6B",
        runtime_config: EmbeddingRuntimeConfig | None = None,
    ):
        self.model_name = model_name
        self.runtime_config = runtime_config or EmbeddingRuntimeConfig()
        self.model = None
        self.dim = 1024
        self.plan: RuntimePlan | None = None
        self.model_parameter_count = estimate_model_parameter_count(model_name)
        self.sequence_length = 2048
        self.oom_backoffs = 0
        self.oom_batch_ceiling: int | None = None
        self.successful_requests_since_oom = 0
        self.warnings: list[str] = []
        self.startup_reason: str | None = None
        self.requested_backend: str | None = None
        self.fail_closed_backend = False
        self.fallback_occurred = False
        self.fallback_reason: str | None = None

    def load(self):
        print(f"Loading model: {self.model_name}", flush=True)
        requested_device = self.runtime_config.device.lower()
        self.requested_backend = requested_device
        preferred_backend, memory = self._select_preferred_backend(requested_device)
        self.fail_closed_backend = preferred_backend in {"vitisai", "openvino"}
        self.model_parameter_count = (
            self.runtime_config.model_parameter_count or self.model_parameter_count
        )
        self.sequence_length = self.runtime_config.max_sequence_length
        self.plan = self._build_plan(preferred_backend, memory, model_resident=False)
        self.startup_reason = self.plan.reason
        if not self.plan.usable:
            raise RuntimeError(
                f"Refusing to load {self.model_name}: {self.plan.reason}. "
                f"System available: {_format_bytes(memory.system_available_bytes)}; "
                f"accelerator free: {_format_optional_bytes(memory.accelerator_free_bytes)}"
            )
        if self.fail_closed_backend and self.plan.backend != preferred_backend:
            raise RuntimeError(
                f"Requested {requested_device} backend selected {self.plan.backend}; "
                f"refusing CPU fallback: {self.plan.reason or 'backend did not remain selected'}"
            )
        self._apply_cpu_threads(self.plan.cpu_threads)
        self._configure_mps_limit(self.plan, memory)
        try:
            self.model = self._load_model(self.plan)
        except Exception as error:
            if self.plan.backend == "cpu":
                raise
            if self.fail_closed_backend:
                raise RuntimeError(
                    f"Requested {requested_device} backend failed; refusing CPU fallback: {_error_summary(error)}"
                ) from error
            warning = f"{self.plan.backend} model initialization failed; falling back to CPU: {_error_summary(error)}"
            self._record_cpu_fallback(warning)
            self._record_warning(warning)
            print(f"WARNING: {warning}", file=sys.stderr, flush=True)
            self._clear_accelerator_cache()
            cpu_plan = self._build_plan("cpu", system_memory_snapshot(), model_resident=True)
            if not cpu_plan.usable:
                raise RuntimeError(f"{warning}; CPU fallback is unsafe: {cpu_plan.reason}") from error
            self.plan = cpu_plan
            self._apply_cpu_threads(cpu_plan.cpu_threads)
            self.model = self._load_model(cpu_plan)

        # Keep enough context for metadata-enriched code chunks while retaining a
        # conservative default for CPU and unified-memory machines.
        tokenizer = getattr(self.model, "tokenizer", None)
        tokenizer_limit = getattr(tokenizer, "model_max_length", self.sequence_length)
        if isinstance(tokenizer_limit, int) and 0 < tokenizer_limit < 10_000_000:
            self.sequence_length = min(self.sequence_length, tokenizer_limit)
        if hasattr(self.model, "max_seq_length"):
            self.model.max_seq_length = self.sequence_length

        exact_parameter_count = self._exact_parameter_count()
        if exact_parameter_count > 0:
            self.model_parameter_count = exact_parameter_count
        self._refresh_active_plan()
        sample = self.encode(["probe"])
        self.dim = len(sample[0])
        print(
            "Model loaded. "
            f"Dim: {self.dim}, max_seq: {getattr(self.model, 'max_seq_length', self.sequence_length)}, "
            f"resources: {json.dumps(self.plan.to_dict(), sort_keys=True)}",
            flush=True,
        )

    def encode(self, texts: list[str], normalize: bool = True) -> list[list[float]]:
        if self.model is None or self.plan is None:
            raise RuntimeError("model not loaded")
        self._refresh_active_plan()
        output: list[list[float]] = []
        offset = 0
        request_had_oom = False
        while offset < len(texts):
            batch_size = min(self._effective_batch_size(), len(texts) - offset)
            try:
                if hasattr(self.model, "backend_id"):
                    # Custom EmbeddingBackend protocol implementation (e.g. AppleANEBackend)
                    raw_vecs = self.model.encode(
                        texts[offset : offset + batch_size],
                        normalize=normalize,
                        batch_size=batch_size,
                    )
                    embeddings = list(raw_vecs)
                else:
                    raw_vecs = self.model.encode(
                        texts[offset : offset + batch_size],
                        normalize_embeddings=normalize,
                        batch_size=batch_size,
                        show_progress_bar=False,
                    )
                    embeddings = raw_vecs.tolist() if hasattr(raw_vecs, "tolist") else list(raw_vecs)
            except Exception as error:
                if not _is_out_of_memory(error):
                    raise
                request_had_oom = True
                self.oom_backoffs += 1
                if batch_size > 1:
                    self.oom_batch_ceiling = max(1, batch_size // 2)
                    self.successful_requests_since_oom = 0
                    self._clear_accelerator_cache()
                    continue
                if self.plan.backend != "cpu" and self._move_to_cpu_after_oom(error):
                    continue
                raise RuntimeError(
                    "Embedding ran out of memory at batch size 1; "
                    "free more RAM or reduce maxSequenceLength in code-rag.json"
                ) from error
            output.extend(embeddings)
            offset += batch_size
            import gc
            gc.collect()
            self._clear_accelerator_cache()

        if not request_had_oom and self.oom_batch_ceiling is not None:
            self.successful_requests_since_oom += 1
            if self.successful_requests_since_oom >= 8:
                self.oom_batch_ceiling = None
                self.successful_requests_since_oom = 0

        return output

    def health(self) -> dict:
        plan = self.plan.to_dict() if self.plan is not None else None
        memory = self._current_memory()
        backend_health: dict = {}
        if hasattr(self.model, "health"):
            try:
                from embedding_backends.health import format_backend_health
                bh = self.model.health()
                backend_health = format_backend_health(bh)
            except Exception:
                pass

        actual_device = str(getattr(self.model, "device", "none"))
        exec_device = backend_health.get("executionDevice") or actual_device or (plan.get("backend") if plan else None)
        selected_backend = backend_health.get("selectedBackend") or (plan.get("backend") if plan else None)
        fallback_occurred = bool(backend_health.get("fallbackOccurred", False) or self.fallback_occurred)
        fallback_reason = backend_health.get("fallbackReason") or self.fallback_reason
        if fallback_occurred and selected_backend != "cpu" and actual_device.lower().startswith("cpu"):
            selected_backend = "cpu"

        return {
            "status": "ready" if self.model is not None else "loading",
            "model": self.model_name,
            "dim": self.dim,
            "device": exec_device,
            "executionDevice": exec_device,
            "executionProvider": backend_health.get("executionProvider") or getattr(self.model, "provider", None),
            "requestedBackend": backend_health.get("requestedBackend") or self.requested_backend or (plan.get("preferred_backend") if plan else None),
            "selectedBackend": selected_backend,
            "gpuAllowed": backend_health.get("gpuAllowed", False),
            "fallbackOccurred": fallback_occurred,
            "fallbackReason": fallback_reason,
            "resource_plan": plan,
            "memory": {
                "system_total_bytes": memory.system_total_bytes,
                "system_available_bytes": memory.system_available_bytes,
                "accelerator_total_bytes": memory.accelerator_total_bytes,
                "accelerator_free_bytes": memory.accelerator_free_bytes,
            },
            "runtime": {
                "torch_version": str(torch.__version__),
                "torch_cuda_version": getattr(torch.version, "cuda", None),
                "torch_hip_version": getattr(torch.version, "hip", None),
                "accelerator_available": bool(torch.cuda.is_available() or _mps_available()),
                "npu_available": _npu_available("npu"),
                "amd_vitisai_provider_available": _vitisai_npu_available(),
                "intel_openvino_npu_available": _openvino_npu_available(),
                "onnxruntime_providers": _onnxruntime_providers(),
                "oom_backoffs": self.oom_backoffs,
                "oom_batch_ceiling": self.oom_batch_ceiling,
                "startup_reason": self.startup_reason,
                "warnings": self.warnings,
            },
        }

    def _select_preferred_backend(self, requested_device: str) -> tuple[str, MemorySnapshot]:
        valid_devices = {
            "auto",
            "cpu",
            "cuda",
            "rocm",
            "mps",
            "npu",
            "openvino",
            "coreml",
            "vitisai",
            "ryzenai",
            "apple-ane",
            "nvidia-cuda",
            "amd-rocm",
            "apple-mps",
            "intel-openvino-cpu",
            "intel-openvino-npu",
            "openvino-npu",
        }
        if requested_device not in valid_devices:
            raise ValueError(f"embeddingDevice must be one of: {', '.join(sorted(valid_devices))}")
        if requested_device == "cpu":
            return "cpu", system_memory_snapshot()
        if requested_device == "intel-openvino-cpu":
            return "cpu", system_memory_snapshot()
        detected_backend, memory = self._detect_accelerator()
        expected_backend = {
            "amd-rocm": "rocm",
            "nvidia-cuda": "cuda",
        }.get(requested_device, requested_device)
        if (
            requested_device == "auto"
            and expected_backend in {"cuda", "rocm"}
            and detected_backend != expected_backend
        ):
            warning = (
                f"installer expected {expected_backend}, but PyTorch detected "
                f"{detected_backend or 'no accelerator'}"
            )
            self._record_warning(warning)
            print(f"WARNING: {warning}", file=sys.stderr, flush=True)
        if requested_device == "auto":
            return detected_backend or "cpu", memory
        if requested_device in {"apple-ane", "npu"} and sys.platform == "darwin":
            if _mps_available():
                warning = "verified Apple ANE model is unavailable; using mps for real Qwen embeddings"
                self._record_warning(warning)
                print(f"WARNING: {warning}", file=sys.stderr, flush=True)
                return "mps", memory
            warning = "verified Apple ANE model is unavailable and mps is unavailable; using CPU"
            self._record_cpu_fallback(warning)
            self._record_warning(warning)
            print(f"WARNING: {warning}", file=sys.stderr, flush=True)
            return "cpu", memory
        if requested_device == "npu":
            if sys.platform != "linux":
                raise RuntimeError("NPU indexing is supported on Apple Silicon or Linux")
            amd_available = _vitisai_npu_available()
            intel_available = _openvino_npu_available()
            if amd_available and intel_available:
                raise RuntimeError(
                    "Both AMD Vitis AI and Intel OpenVINO NPU runtimes are available; "
                    "select ryzenai or intel-openvino-npu explicitly"
                )
            if amd_available:
                return "vitisai", memory
            if intel_available:
                return "openvino", memory
            raise RuntimeError(
                "NPU requested, but no validated AMD Vitis AI or Intel OpenVINO NPU runtime is available"
            )
        if requested_device in {"vitisai", "ryzenai"}:
            if sys.platform != "linux":
                raise RuntimeError("AMD Ryzen AI/Vitis AI indexing is supported only on Linux")
            if _vitisai_npu_available():
                return "vitisai", memory
            raise RuntimeError(
                "AMD Ryzen AI/Vitis AI requested, but VitisAIExecutionProvider is not available "
                "in the indexing Python environment"
            )
        if requested_device in {"openvino", "openvino-npu", "intel-openvino-npu"}:
            if sys.platform != "linux":
                raise RuntimeError("Intel OpenVINO NPU indexing is supported only on Linux")
            if _openvino_npu_available():
                return "openvino", memory
            raise RuntimeError(
                "Intel OpenVINO NPU requested, but OpenVINO does not expose an NPU device"
            )
        torch_backend = {
            "amd-rocm": "rocm",
            "apple-mps": "mps",
            "nvidia-cuda": "cuda",
        }.get(requested_device, requested_device)
        if torch_backend in {"cuda", "rocm", "mps"} and detected_backend == torch_backend:
            return torch_backend, memory
        if requested_device == "coreml" and _npu_available(requested_device):
            return requested_device, memory
        if requested_device in {"npu", "coreml"} and _mps_available():
            warning = f"requested {requested_device} backend is unavailable or not natively supported by PyTorch; falling back to mps (Metal)"
            self._record_warning(warning)
            print(f"WARNING: {warning}", file=sys.stderr, flush=True)
            return "mps", memory
        warning = f"requested {requested_device} backend is unavailable; using CPU"
        self._record_cpu_fallback(warning)
        self._record_warning(warning)
        print(f"WARNING: {warning}", file=sys.stderr, flush=True)
        return "cpu", memory

    def _detect_accelerator(self) -> tuple[str | None, MemorySnapshot]:
        if self.runtime_config.device.lower() == "cpu":
            return None, system_memory_snapshot()
        now = time.monotonic()
        if hasattr(self, "_cached_accelerator") and self._cached_accelerator is not None:
            cached_backend, cached_memory, cached_time = self._cached_accelerator
            if now - cached_time < 15.0:
                return cached_backend, cached_memory

        memory = system_memory_snapshot()
        backend: str | None = None
        if torch.cuda.is_available():
            try:
                accelerator_free, accelerator_total = torch.cuda.mem_get_info()
            except Exception as error:
                self._record_warning(f"unable to read CUDA/ROCm memory: {_error_summary(error)}")
                accelerator_free, accelerator_total = None, None
            backend = "rocm" if getattr(torch.version, "hip", None) else "cuda"
            memory = replace(
                memory,
                accelerator_total_bytes=accelerator_total,
                accelerator_free_bytes=accelerator_free,
            )
        elif _mps_available():
            backend = "mps"
            memory = replace(
                memory,
                accelerator_total_bytes=memory.system_total_bytes,
                accelerator_free_bytes=memory.system_available_bytes,
            )

        self._cached_accelerator = (backend, memory, now)
        return backend, memory

    def _current_memory(self) -> MemorySnapshot:
        detected_backend, memory = self._detect_accelerator()
        if self.plan is not None and self.plan.backend in {"cuda", "rocm"} and detected_backend is None:
            self._record_warning("CUDA/ROCm backend became unavailable")
        return memory

    def _build_plan(self, backend: str, memory: MemorySnapshot, model_resident: bool) -> RuntimePlan:
        return build_runtime_plan(
            preferred_backend=backend,
            logical_cpu_count=os.cpu_count() or 1,
            memory=memory,
            model_parameter_count=self.model_parameter_count,
            sequence_length=self.sequence_length,
            max_batch_size=self.runtime_config.max_embedding_batch_size,
            max_cpu_threads=self.runtime_config.max_cpu_threads,
            min_system_reserve_bytes=self.runtime_config.min_system_memory_reserve_bytes,
            min_accelerator_reserve_bytes=self.runtime_config.min_accelerator_memory_reserve_bytes,
            model_resident=model_resident,
        )

    def _load_model(self, plan: RuntimePlan):
        if plan.backend == "apple-ane":
            from embedding_backends.apple_ane_backend import AppleANEBackend
            from embedding_backends.base import ModelSpec
            ane_backend = AppleANEBackend("apple-ane", strict=False)
            ane_backend.load(ModelSpec(model_name=self.model_name, dimensions=self.dim))
            return ane_backend

        if plan.backend == "cpu":
            return SentenceTransformer(self.model_name, device="cpu")
        if plan.backend == "openvino":
            from embedding_backends.base import ModelSpec
            from embedding_backends.openvino_backend import OpenVINOBackend

            openvino_backend = OpenVINOBackend(
                "intel-openvino-npu",
                strict=True,
                cache_directory=self.runtime_config.openvino_cache_directory,
            )
            openvino_backend.load(
                ModelSpec(
                    model_name=self.model_name,
                    dimensions=self.dim,
                    sequence_length=self.sequence_length,
                    pooling=EMBEDDING_POOLING,
                    normalization=EMBEDDING_NORMALIZATION,
                )
            )
            return openvino_backend
        # Attempt ONNX Runtime load for CoreML/NPU/CPU/GPU if optimum.onnxruntime is available and model is cached or pre-exported
        onnx_cache_dir = os.path.expanduser(f"~/.p/agent/indexing-service/onnx-cache/{self.model_name.replace('/', '_')}")
        hf_onnx_repos = {
            "Qwen/Qwen3-Embedding-0.6B": "onnx-community/Qwen3-Embedding-0.6B-ONNX",
        }
        pre_exported_hf = hf_onnx_repos.get(self.model_name)
        has_onnx_source = pre_exported_hf or os.path.exists(os.path.join(onnx_cache_dir, "model.onnx"))

        if has_onnx_source or plan.backend in {"coreml", "openvino", "vitisai"}:
            try:
                import onnxruntime as ort
                from optimum.onnxruntime import ORTModelForFeatureExtraction
                from transformers import AutoTokenizer

                session_options = ort.SessionOptions()
                session_options.enable_cpu_mem_arena = False

                # NOTE: CoreMLExecutionProvider is deliberately NOT used here.
                # For Qwen3-Embedding-0.6B it supports only ~50% of graph nodes
                # (1834/3644), compiling 197 subgraphs into separate CoreML models.
                # This causes 30+ GB virtual memory and forces the entire OS into
                # swap. CPUExecutionProvider with disabled arena is predictable and
                # stays under 1.5 GB RSS.
                provider = "CPUExecutionProvider"
                device_label = "cpu (ONNX Runtime)"
                provider_options = None
                if plan.backend in {"cuda", "gpu"}:
                    provider = "CUDAExecutionProvider"
                    device_label = "cuda:0 (ONNX Runtime)"
                elif plan.backend == "vitisai" and sys.platform == "linux":
                    available_providers = ort.get_available_providers()
                    if "VitisAIExecutionProvider" in available_providers:
                        provider = "VitisAIExecutionProvider"
                        device_label = "vitisai (AMD XDNA NPU via ONNX Runtime)"
                        provider_options = _vitisai_provider_options(
                            self.model_name,
                            cache_dir=self.runtime_config.vitisai_cache_directory,
                            cache_key=self.runtime_config.vitisai_cache_key,
                            config_file=self.runtime_config.vitisai_config_file,
                            log_level=self.runtime_config.vitisai_log_level,
                        )
                        session_options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
                    else:
                        raise RuntimeError("VitisAIExecutionProvider is not available in this Python environment")
                elif plan.backend == "openvino" and sys.platform == "linux":
                    available_providers = ort.get_available_providers()
                    if "OpenVINOExecutionProvider" in available_providers:
                        provider = "OpenVINOExecutionProvider"
                        device_label = "openvino (Intel ONNX Runtime)"
                    else:
                        raise RuntimeError("OpenVINOExecutionProvider is not available in this Python environment")

                from transformers import AutoConfig

                config = None
                try:
                    config = AutoConfig.from_pretrained(pre_exported_hf or self.model_name)
                    config.use_cache = False
                except Exception:
                    pass

                tokenizer = AutoTokenizer.from_pretrained(pre_exported_hf or self.model_name)
                load_kwargs = {}
                if config is not None:
                    load_kwargs["config"] = config
                if provider_options is not None:
                    load_kwargs["provider_options"] = provider_options

                if os.path.exists(os.path.join(onnx_cache_dir, "model.onnx")):
                    print(f"Loading cached ONNX model ({provider}): {onnx_cache_dir}", flush=True)
                    ort_model = ORTModelForFeatureExtraction.from_pretrained(
                        onnx_cache_dir,
                        export=False,
                        file_name="model.onnx",
                        provider=provider,
                        session_options=session_options,
                        **load_kwargs,
                    )
                elif pre_exported_hf:
                    print(f"Loading pre-exported ONNX model from Hugging Face ({provider}): {pre_exported_hf}", flush=True)
                    ort_model = ORTModelForFeatureExtraction.from_pretrained(
                        pre_exported_hf,
                        export=False,
                        provider=provider,
                        session_options=session_options,
                        **load_kwargs,
                    )
                    try:
                        os.makedirs(onnx_cache_dir, exist_ok=True)
                        ort_model.save_pretrained(onnx_cache_dir)
                    except Exception:
                        pass
                else:
                    ort_model = ORTModelForFeatureExtraction.from_pretrained(
                        self.model_name,
                        export=True,
                        provider=provider,
                        **load_kwargs,
                    )
                    try:
                        os.makedirs(onnx_cache_dir, exist_ok=True)
                        ort_model.save_pretrained(onnx_cache_dir)
                        print(f"Saved ONNX model to cache: {onnx_cache_dir}", flush=True)
                    except Exception as cache_err:
                        print(f"Note: ONNX caching skipped: {cache_err}", flush=True)

                wrapper = ONNXEmbeddingWrapper(
                    ort_model,
                    tokenizer,
                    device_name=device_label,
                    model_name=self.model_name,
                    dimensions=self.dim,
                    requested_backend=self.requested_backend or plan.preferred_backend,
                    selected_backend=plan.backend,
                    provider=provider,
                    allow_runtime_cpu_fallback=plan.backend not in {"vitisai", "openvino"},
                )
                if plan.backend == "vitisai":
                    selected_providers = list(ort_model.model.get_providers())
                    if not selected_providers or selected_providers[0] != "VitisAIExecutionProvider":
                        raise RuntimeError(
                            f"Vitis AI session selected unexpected providers: {selected_providers}"
                        )
                wrapper.encode(["probe"], batch_size=1)
                print(f"Loaded model on {device_label}", flush=True)
                return wrapper
            except Exception as error:
                if plan.backend in {"vitisai", "openvino"}:
                    raise
                warning = f"ONNX Runtime load failed ({_error_summary(error)}); falling back to standard PyTorch backend"
                self._record_warning(warning)
                print(f"WARNING: {warning}", file=sys.stderr, flush=True)

        target_device = plan.device
        if target_device in {"npu", "openvino", "coreml", "vitisai"}:
            if _mps_available():
                warning = f"{target_device} device not natively supported by SentenceTransformer; using mps (Metal)"
                self._record_warning(warning)
                print(f"WARNING: {warning}", file=sys.stderr, flush=True)
                target_device = "mps"
            else:
                warning = f"{target_device} device not natively supported by SentenceTransformer; using CPU"
                self._record_cpu_fallback(warning)
                self._record_warning(warning)
                print(f"WARNING: {warning}", file=sys.stderr, flush=True)
                target_device = "cpu"
        dtype = torch.float32 if plan.dtype == "float32" else torch.float16
        return SentenceTransformer(
            self.model_name,
            device=target_device,
            model_kwargs={"torch_dtype": dtype},
        )

    def _refresh_active_plan(self):
        if self.plan is None:
            return
        current_backend = self.plan.backend
        memory = self._current_memory()
        refreshed_plan = self._build_plan(current_backend, memory, model_resident=True)
        if refreshed_plan.backend == "cpu" and current_backend != "cpu":
            if self.fail_closed_backend:
                raise RuntimeError(
                    f"{current_backend} memory pressure crossed the safety reserve; refusing CPU fallback"
                )
            cpu_plan = self._build_plan("cpu", system_memory_snapshot(), model_resident=False)
            if cpu_plan.usable:
                self._move_model_to_cpu(cpu_plan, f"{current_backend} memory pressure crossed the safety reserve")
                return
            self._record_warning(
                f"{current_backend} memory is constrained, but CPU fallback is unsafe: {cpu_plan.reason}"
            )
            return
        if refreshed_plan.usable:
            self.plan = refreshed_plan
            self._apply_cpu_threads(refreshed_plan.cpu_threads)

    def _move_to_cpu_after_oom(self, error: Exception) -> bool:
        if self.fail_closed_backend:
            self._record_warning(
                f"refusing CPU fallback after accelerator OOM: {_error_summary(error)}"
            )
            return False
        cpu_plan = self._build_plan("cpu", system_memory_snapshot(), model_resident=False)
        if not cpu_plan.usable:
            self._record_warning(f"CPU fallback after OOM is unsafe: {cpu_plan.reason}")
            return False
        self._move_model_to_cpu(cpu_plan, f"accelerator OOM at batch size 1: {_error_summary(error)}")
        return True

    def _move_model_to_cpu(self, cpu_plan: RuntimePlan, reason: str):
        if self.model is None:
            raise RuntimeError("model not loaded")
        self.model.to(device="cpu", dtype=torch.float32)
        self._clear_accelerator_cache()
        self.plan = cpu_plan
        self.oom_batch_ceiling = None
        self.successful_requests_since_oom = 0
        self._apply_cpu_threads(cpu_plan.cpu_threads)
        warning = f"{reason}; moved model to CPU"
        self._record_cpu_fallback(warning)
        self._record_warning(warning)

    def _record_cpu_fallback(self, reason: str):
        self.fallback_occurred = True
        self.fallback_reason = reason

    def _effective_batch_size(self) -> int:
        if self.plan is None:
            return 1
        if self.oom_batch_ceiling is None:
            return self.plan.batch_size
        return min(self.plan.batch_size, self.oom_batch_ceiling)

    def _exact_parameter_count(self) -> int:
        if self.model is None:
            return 0
        try:
            return sum(parameter.numel() for parameter in self.model.parameters())
        except Exception:
            return 0

    def _apply_cpu_threads(self, cpu_threads: int):
        try:
            if torch.get_num_threads() != cpu_threads:
                torch.set_num_threads(cpu_threads)
        except Exception as error:
            self._record_warning(f"unable to set PyTorch CPU threads: {_error_summary(error)}")

    def _configure_mps_limit(self, plan: RuntimePlan, memory: MemorySnapshot):
        if plan.backend != "mps" or not hasattr(torch.mps, "set_per_process_memory_fraction"):
            return
        usable_fraction = (
            (memory.system_available_bytes - plan.system_reserve_bytes) / memory.system_total_bytes
            if memory.system_total_bytes > 0
            else 0.5
        )
        try:
            torch.mps.set_per_process_memory_fraction(max(0.1, min(0.5, usable_fraction)))
        except Exception as error:
            self._record_warning(f"unable to set MPS memory fraction: {_error_summary(error)}")

    def _clear_accelerator_cache(self):
        try:
            if _mps_available() and hasattr(torch.mps, "empty_cache"):
                torch.mps.empty_cache()
            elif torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception as error:
            self._record_warning(f"unable to clear accelerator cache: {_error_summary(error)}")

    def _record_warning(self, warning: str):
        if warning in self.warnings:
            return
        self.warnings.append(warning)
        self.warnings = self.warnings[-8:]


server: EmbeddingServer | None = None
encode_lock: threading.Lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            if server is None or server.model is None:
                self._json(503, {"status": "loading"})
            else:
                self._json(200, server.health())
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/embed":
            self._json(404, {"error": "not found"})
            return

        if server is None or server.model is None:
            self._json(503, {"error": "model not loaded"})
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            texts: list[str] = body.get("input", [])
            normalize = body.get("normalize", True)

            if not texts:
                self._json(400, {"error": "empty input"})
                return

            with encode_lock, torch.inference_mode():
                embeddings = server.encode(texts, normalize)

            self._json(200, {
                "model": server.model_name,
                "dim": server.dim,
                "embeddings": embeddings,
            })

            import gc
            gc.collect()
        except (BrokenPipeError, ConnectionResetError):
            # Client disconnected — don't crash the server
            self.close_connection = True
        except Exception as e:
            traceback.print_exc()
            try:
                self._json(500, {"error": str(e)})
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True

    def _json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        pass  # silence request logs


def _mps_available() -> bool:
    return bool(hasattr(torch.backends, "mps") and torch.backends.mps.is_available())


def _is_out_of_memory(error: Exception) -> bool:
    return (
        isinstance(error, MemoryError)
        or error.__class__.__name__ == "OutOfMemoryError"
        or "out of memory" in str(error).lower()
    )


def _error_summary(error: Exception) -> str:
    return f"{error.__class__.__name__}: {str(error).replace(chr(10), ' ')[:300]}"


def _format_bytes(value: int) -> str:
    return f"{value / GIB:.2f} GiB"


def _format_optional_bytes(value: int | None) -> str:
    return "unavailable" if value is None else _format_bytes(value)


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True

    def server_close(self):
        try:
            super().server_close()
        except OSError:
            pass  # Ignore "Cannot assign requested address" on close


def main():
    parser = argparse.ArgumentParser(description="Embedding server for code-index")
    parser.add_argument("--port", type=int, default=18742)
    parser.add_argument("--model")
    parser.add_argument("--config")
    args = parser.parse_args()
    runtime_config = load_embedding_runtime_config(args.config)

    global server
    server = EmbeddingServer(args.model or runtime_config.embedding_model, runtime_config)
    server.load()

    addr = ("127.0.0.1", args.port)
    httpd = ThreadedHTTPServer(addr, Handler)
    print(f"Embedding server listening on http://{addr[0]}:{addr[1]} (threaded)", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
