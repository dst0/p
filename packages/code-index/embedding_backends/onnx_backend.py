"""ONNX Runtime backend for CPU and GPU inference."""

import os
from typing import Any
from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash


def _last_token_pool_np(token_embeddings, attention_mask, np_module):
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


class ONNXBackend:
    """ONNX Runtime backend for CPU and GPU inference."""

    def __init__(self, backend_id: str = "cpu", strict: bool = False):
        self.backend_id = backend_id
        self.strict = strict
        self.execution_device = "CPU (ONNX Runtime)"
        self.gpu_allowed = False
        self.model: Any = None
        self.tokenizer: Any = None
        self.spec: ModelSpec = ModelSpec()
        self.fallback_occurred = False
        self.fallback_reason: str | None = None

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        self._np = np
        self.tokenizer = AutoTokenizer.from_pretrained(spec.model_name)

        onnx_cache_dir = os.path.expanduser(
            f"~/.p/agent/indexing-service/onnx-cache/{spec.model_name.replace('/', '_')}"
        )
        model_path = os.path.join(onnx_cache_dir, "model.onnx")

        if not os.path.exists(model_path):

            from optimum.onnxruntime import ORTModelForFeatureExtraction
            from transformers import AutoConfig

            config = None
            try:
                config = AutoConfig.from_pretrained(spec.model_name)
                config.use_cache = False
            except Exception:
                pass

            load_kwargs = {}
            if config is not None:
                load_kwargs["config"] = config

            hf_repo = "onnx-community/Qwen3-Embedding-0.6B-ONNX"
            self.model = ORTModelForFeatureExtraction.from_pretrained(
                hf_repo, export=False, provider="CPUExecutionProvider", **load_kwargs
            )
            self.model.save_pretrained(onnx_cache_dir)
            self.tokenizer.save_pretrained(onnx_cache_dir)
        else:
            opts = ort.SessionOptions()
            opts.enable_cpu_mem_arena = False
            opts.enable_mem_pattern = True
            opts.intra_op_num_threads = 4

            self.session = ort.InferenceSession(
                model_path,
                sess_options=opts,
                providers=["CPUExecutionProvider"],
            )

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        if hasattr(self, "session"):
            return self._encode_session(texts, normalize, batch_size)
        if self.model is not None:
            return self._encode_optimum(texts, normalize, batch_size)
        raise RuntimeError("ONNXBackend model not loaded")

    def _encode_session(
        self, texts: list[str], normalize: bool, batch_size: int
    ) -> list[list[float]]:
        all_embeddings = []
        model_input_names = {inp.name for inp in self.session.get_inputs()}

        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            tok = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=self.spec.sequence_length,
                return_tensors="np",
            )
            if "position_ids" in model_input_names and "position_ids" not in tok:
                seq_len = tok["input_ids"].shape[1]
                tok["position_ids"] = self._np.tile(
                    self._np.arange(seq_len, dtype=self._np.int64), (len(batch), 1)
                )

            inputs = {k: v for k, v in tok.items() if k in model_input_names}
            outputs = self.session.run(None, inputs)

            token_embeddings = outputs[0]
            attention_mask = tok["attention_mask"]
            embeddings = _last_token_pool_np(token_embeddings, attention_mask, self._np)

            if normalize:
                norms = self._np.linalg.norm(embeddings, axis=1, keepdims=True)
                embeddings = embeddings / self._np.clip(norms, a_min=1e-9, a_max=None)

            all_embeddings.extend(embeddings.tolist())
            del tok, inputs, outputs, token_embeddings, attention_mask

        import gc
        gc.collect()
        return all_embeddings

    def _encode_optimum(
        self, texts: list[str], normalize: bool, batch_size: int
    ) -> list[list[float]]:
        tok = self.tokenizer(
            texts,
            padding=True,
            truncation=True,
            max_length=self.spec.sequence_length,
            return_tensors="np",
        )
        outputs = self.model(**tok)
        token_embeddings = outputs[0]
        attention_mask = tok["attention_mask"]
        embeddings = _last_token_pool_np(token_embeddings, attention_mask, self._np)

        if normalize:
            norms = self._np.linalg.norm(embeddings, axis=1, keepdims=True)
            embeddings = embeddings / self._np.clip(norms, a_min=1e-9, a_max=None)

        return embeddings.tolist()

    def health(self) -> BackendHealth:
        tok_hash = compute_tokenizer_hash(self.spec.model_name)
        compat_group = compute_compatibility_group(
            self.spec.model_name,
            self.spec.dimensions,
            self.spec.pooling,
            self.spec.normalization,
        )
        return BackendHealth(
            status="ready" if (self.model is not None or hasattr(self, "session")) else "loading",
            requested_backend=self.backend_id,
            selected_backend="cpu",
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
        if hasattr(self, "session"):
            del self.session
