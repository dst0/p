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

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
if os.environ.get("P_CODE_RAG_DEVICE", "cpu").lower() == "cpu":
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
    MIB,
    MemorySnapshot,
    RuntimePlan,
    build_runtime_plan,
    estimate_model_parameter_count,
    read_positive_int_environment,
    system_memory_snapshot,
)
from embedding_backends.base import BackendHealth
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash


EMBEDDING_POOLING = "last-non-padding-token"
EMBEDDING_NORMALIZATION = "l2"


def _last_token_pool_np(token_embeddings, attention_mask, np_module):
    if token_embeddings.shape[0] == 0:
        return token_embeddings[:, 0]
    last_column_is_real_token = bool(np_module.all(attention_mask[:, -1] == 1))
    if last_column_is_real_token:
        return token_embeddings[:, -1]
    sequence_lengths = np_module.clip(
        attention_mask.sum(axis=1) - 1,
        a_min=0,
        a_max=token_embeddings.shape[1] - 1,
    ).astype(np_module.int64)
    batch_indices = np_module.arange(token_embeddings.shape[0])
    return token_embeddings[batch_indices, sequence_lengths]


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


class ONNXEmbeddingWrapper:
    """Wraps an ONNX Runtime model for fast inference on CPU, GPU, or NPU."""

    def __init__(
        self,
        model,
        tokenizer,
        device_name: str = "npu:0 (CoreML/ANE)",
        *,
        model_name: str = "Qwen/Qwen3-Embedding-0.6B",
        dimensions: int = 1024,
        requested_backend: str = "onnx",
        selected_backend: str = "onnx",
        provider: str = "CPUExecutionProvider",
        allow_runtime_cpu_fallback: bool = True,
    ):
        import numpy as np
        self.model = model
        self.tokenizer = tokenizer
        self.device = device_name
        self.max_seq_length = getattr(tokenizer, "model_max_length", 2048)
        self._np = np
        self.model_name = model_name
        self.dimensions = dimensions
        self.requested_backend = requested_backend
        self.selected_backend = selected_backend
        self.provider = provider
        self.allow_runtime_cpu_fallback = allow_runtime_cpu_fallback
        self.fallback_occurred = False
        self.fallback_reason: str | None = None

    def _get_model_input_names(self):
        """Return the set of input names expected by the underlying ONNX session."""
        try:
            # optimum ORTModel exposes the session inputs
            return {inp.name for inp in self.model.model.get_inputs()}
        except Exception:
            return None

    def encode(self, texts: list[str], normalize_embeddings: bool = True, batch_size: int = 8, show_progress_bar: bool = False):
        all_embeddings = []
        model_input_names = self._get_model_input_names()
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            tok = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=self.max_seq_length,
                return_tensors="np",
            )
            # Build position_ids if the model needs them but the tokenizer did not return them.
            if model_input_names and "position_ids" in model_input_names and "position_ids" not in tok:
                seq_len = tok["input_ids"].shape[1]
                tok["position_ids"] = self._np.tile(
                    self._np.arange(seq_len, dtype=self._np.int64), (len(batch), 1)
                )
            # Build dummy past_key_values if the ONNX graph expects them.
            if model_input_names:
                pkv_names = [n for n in model_input_names if n.startswith("past_key_values")]
                if pkv_names:
                    config = getattr(self.model, "config", None)
                    num_heads = getattr(config, "num_key_value_heads", getattr(config, "num_attention_heads", 16))
                    head_dim = getattr(config, "head_dim", 64)
                    for pkv in pkv_names:
                        if pkv not in tok:
                            tok[pkv] = self._np.zeros((len(batch), num_heads, 0, head_dim), dtype=self._np.float32)
            # Pass only inputs the model expects (avoid unknown-input errors).
            if model_input_names:
                inputs = {k: v for k, v in tok.items() if k in model_input_names}
            else:
                inputs = dict(tok)
            # ORTModelForFeatureExtraction.forward() only accepts known args
            # (input_ids, attention_mask, position_ids, etc.) and silently drops
            # unknown **kwargs (including past_key_values.*).  When the ONNX graph
            # requires past_key_values we must call the raw InferenceSession
            # directly so every input reaches the runtime.
            has_pkv = any(k.startswith("past_key_values") for k in inputs)
            try:
                if has_pkv and hasattr(self.model, "model") and hasattr(self.model.model, "run"):
                    session = self.model.model
                    output_names = [o.name for o in session.get_outputs()]
                    np_feeds = {k: v if isinstance(v, self._np.ndarray) else self._np.asarray(v) for k, v in inputs.items()}
                    raw_outputs = session.run(output_names, np_feeds)
                    outputs = (raw_outputs[0],)
                else:
                    outputs = self.model(**inputs)
            except Exception as ort_err:
                if not self.allow_runtime_cpu_fallback:
                    raise
                if hasattr(self.model, "model") and hasattr(self.model.model, "set_providers"):
                    try:
                        self.model.model.set_providers(["CPUExecutionProvider"])
                        self._record_cpu_fallback(
                            f"{self.provider} batch execution failed: {_error_summary(ort_err)}"
                        )
                        if has_pkv and hasattr(self.model.model, "run"):
                            session = self.model.model
                            output_names = [o.name for o in session.get_outputs()]
                            np_feeds = {k: v if isinstance(v, self._np.ndarray) else self._np.asarray(v) for k, v in inputs.items()}
                            raw_outputs = session.run(output_names, np_feeds)
                            outputs = (raw_outputs[0],)
                        else:
                            outputs = self.model(**inputs)
                    except Exception:
                        raise ort_err
                else:
                    raise ort_err
            token_embeddings = outputs[0]
            attention_mask = tok["attention_mask"]
            embeddings = _last_token_pool_np(token_embeddings, attention_mask, self._np)
            if normalize_embeddings:
                norms = self._np.linalg.norm(embeddings, axis=1, keepdims=True)
                embeddings = embeddings / self._np.clip(norms, a_min=1e-9, a_max=None)
            all_embeddings.append(embeddings)
            del tok, inputs, outputs, token_embeddings, attention_mask
        result = self._np.vstack(all_embeddings) if all_embeddings else self._np.array([])
        del all_embeddings
        import gc
        gc.collect()
        return result

    def _record_cpu_fallback(self, reason: str):
        self.fallback_occurred = True
        self.fallback_reason = reason
        self.selected_backend = "cpu"
        self.provider = "CPUExecutionProvider"
        self.device = "cpu (ONNX Runtime fallback)"

    def to(self, device=None, dtype=None):
        if device == "cpu":
            self._record_cpu_fallback("embedding server moved ONNX Runtime session to CPU")
        return self

    def parameters(self):
        # No torch parameters in CoreML ONNX model; return empty iterator.
        return iter([])

    def health(self) -> BackendHealth:
        tokenizer_hash = compute_tokenizer_hash(self.model_name)
        compatibility_group = compute_compatibility_group(
            self.model_name,
            self.dimensions,
            EMBEDDING_POOLING,
            EMBEDDING_NORMALIZATION,
        )
        return BackendHealth(
            status="ready",
            requested_backend=self.requested_backend,
            selected_backend=self.selected_backend,
            execution_device=self.device,
            gpu_allowed=self.selected_backend not in {"cpu", "onnx-cpu"},
            fallback_occurred=self.fallback_occurred,
            fallback_reason=self.fallback_reason,
            model_name=self.model_name,
            dimensions=self.dimensions,
            tokenizer_hash=tokenizer_hash,
            pooling=EMBEDDING_POOLING,
            normalization=EMBEDDING_NORMALIZATION,
            compatibility_group=compatibility_group,
        )


class EmbeddingServer:
    def __init__(self, model_name: str = "Qwen/Qwen3-Embedding-0.6B"):
        self.model_name = model_name
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
        requested_device = os.environ.get("P_CODE_RAG_DEVICE", "auto").lower()
        self.requested_backend = requested_device
        self.fail_closed_backend = requested_device in {"npu", "vitisai", "ryzenai"}
        preferred_backend, memory = self._select_preferred_backend(requested_device)
        self.model_parameter_count = read_positive_int_environment(
            "P_CODE_RAG_MODEL_PARAMETER_COUNT",
            self.model_parameter_count,
        )
        self.sequence_length = read_positive_int_environment(
            "P_CODE_RAG_MAX_SEQUENCE_LENGTH",
            2048,
        )
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
                    "free more RAM or reduce P_CODE_RAG_MAX_SEQUENCE_LENGTH"
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
        }
        if requested_device not in valid_devices:
            raise ValueError(f"P_CODE_RAG_DEVICE must be one of: {', '.join(sorted(valid_devices))}")
        if requested_device == "cpu":
            return "cpu", system_memory_snapshot()
        if requested_device == "npu" and sys.platform != "darwin":
            raise RuntimeError(
                "Generic Linux NPU selection is disabled because it cannot prove AMD Ryzen AI execution. "
                "Use CPU, or configure an explicit Ryzen AI/Vitis AI runtime and set P_CODE_RAG_DEVICE=ryzenai."
            )
        detected_backend, memory = self._detect_accelerator()
        expected_backend = os.environ.get("P_CODE_RAG_EXPECTED_BACKEND")
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
            return "apple-ane", memory
        if requested_device in {"vitisai", "ryzenai"}:
            if sys.platform != "linux":
                raise RuntimeError("AMD Ryzen AI/Vitis AI indexing is supported only on Linux")
            if not _vitisai_npu_available():
                raise RuntimeError(
                    "AMD Ryzen AI/Vitis AI requested, but VitisAIExecutionProvider is not available "
                    "in the indexing Python environment"
                )
            return "vitisai", memory
        if (
            (requested_device in {"cuda", "nvidia-cuda", "rocm", "amd-rocm", "mps", "apple-mps"} and detected_backend == requested_device)
            or (requested_device in {"openvino", "coreml"} and _npu_available(requested_device))
        ):
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
        if os.environ.get("P_CODE_RAG_DEVICE", "cpu").lower() == "cpu":
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
        max_batch_size = read_positive_int_environment("P_CODE_RAG_MAX_EMBED_BATCH_SIZE", 8)
        max_cpu_threads = read_positive_int_environment(
            "P_CODE_RAG_MAX_CPU_THREADS",
            os.cpu_count() or 1,
        )
        min_system_reserve_bytes = (
            read_positive_int_environment("P_CODE_RAG_MIN_SYSTEM_MEMORY_RESERVE_MB", 1024) * MIB
        )
        min_accelerator_reserve_bytes = (
            read_positive_int_environment("P_CODE_RAG_MIN_ACCELERATOR_MEMORY_RESERVE_MB", 512) * MIB
        )
        return build_runtime_plan(
            preferred_backend=backend,
            logical_cpu_count=os.cpu_count() or 1,
            memory=memory,
            model_parameter_count=self.model_parameter_count,
            sequence_length=self.sequence_length,
            max_batch_size=max_batch_size,
            max_cpu_threads=max_cpu_threads,
            min_system_reserve_bytes=min_system_reserve_bytes,
            min_accelerator_reserve_bytes=min_accelerator_reserve_bytes,
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
        if plan.backend == "openvino" and _openvino_npu_available():
            try:
                from optimum.intel import OVSentenceTransformer
                return OVSentenceTransformer.from_pretrained(self.model_name, device="NPU")
            except Exception as error:
                self._record_warning(f"OpenVINO NPU load failed; falling back: {_error_summary(error)}")
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
                        provider_options = _vitisai_provider_options(self.model_name)
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
                    allow_runtime_cpu_fallback=plan.backend != "vitisai",
                )
                wrapper.encode(["probe"], batch_size=1)
                print(f"Loaded model on {device_label}", flush=True)
                return wrapper
            except Exception as error:
                if plan.backend == "vitisai":
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


def _openvino_npu_available() -> bool:
    try:
        import openvino as ov
        core = ov.Core()
        return "NPU" in core.available_devices
    except Exception:
        return False


def _coreml_ane_available() -> bool:
    """Return True if CoreML execution via ONNX Runtime is available.

    We intentionally do NOT rely on coremltools importability as the sole signal:
    coremltools 9.x ships without its native extension (.so) on Python 3.14+,
    so `import coremltools` succeeds but all CoreML operations fail at runtime.
    The definitive check is whether onnxruntime exposes CoreMLExecutionProvider.
    """
    if sys.platform != "darwin":
        return False
    try:
        import onnxruntime as ort
        if "CoreMLExecutionProvider" in ort.get_available_providers():
            return True
    except Exception:
        pass
    # Fallback: coremltools can drive CoreML directly if its native lib works.
    try:
        import coremltools

        # Verify the native extension is actually loaded (not just the pure-Python stub).
        import coremltools.libcoremlpython  # noqa: F401
        return True
    except Exception:
        return False


def _vitisai_npu_available() -> bool:
    try:
        import onnxruntime as ort
        return "VitisAIExecutionProvider" in ort.get_available_providers()
    except Exception:
        return False


def _npu_available(backend: str = "npu") -> bool:
    if backend == "npu":
        return sys.platform == "darwin" and _coreml_ane_available()
    if backend == "openvino" and _openvino_npu_available():
        return True
    if backend == "coreml" and _coreml_ane_available():
        return True
    if backend in {"vitisai", "ryzenai"} and _vitisai_npu_available():
        return True
    return False


def _vitisai_provider_options(model_name: str) -> dict[str, str]:
    config_file = os.environ.get("P_CODE_RAG_VITISAI_CONFIG_FILE")
    if not config_file:
        raise RuntimeError(
            "P_CODE_RAG_VITISAI_CONFIG_FILE is required for AMD Ryzen AI/Vitis AI execution"
        )
    if not os.path.exists(config_file):
        raise RuntimeError(f"Vitis AI config file does not exist: {config_file}")
    cache_dir = os.environ.get(
        "P_CODE_RAG_VITISAI_CACHE_DIR",
        os.path.expanduser("~/.p/agent/indexing-service/vitisai-cache"),
    )
    cache_key = os.environ.get("P_CODE_RAG_VITISAI_CACHE_KEY", model_name.replace("/", "_"))
    os.makedirs(cache_dir, exist_ok=True)
    return {
        "config_file": config_file,
        "cache_dir": cache_dir,
        "cache_key": cache_key,
    }


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
    parser.add_argument("--model", default="Qwen/Qwen3-Embedding-0.6B")
    args = parser.parse_args()

    global server
    server = EmbeddingServer(args.model)
    server.load()

    addr = ("127.0.0.1", args.port)
    httpd = ThreadedHTTPServer(addr, Handler)
    print(f"Embedding server listening on http://{addr[0]}:{addr[1]} (threaded)", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
