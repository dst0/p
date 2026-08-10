"""ONNX Runtime adapter used by the managed embedding server."""

from embedding_backends.base import BackendHealth
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash

EMBEDDING_POOLING = "last-non-padding-token"
EMBEDDING_NORMALIZATION = "l2"


def last_token_pool_np(token_embeddings, attention_mask, np_module):
    if token_embeddings.shape[0] == 0:
        return token_embeddings[:, 0]
    if bool(np_module.all(attention_mask[:, -1] == 1)):
        sequence_lengths = np_module.full(
            (attention_mask.shape[0],),
            attention_mask.shape[1] - 1,
            dtype=np_module.int64,
        )
    else:
        sequence_lengths = np_module.maximum(attention_mask.sum(axis=1) - 1, 0).astype(np_module.int64)
    return token_embeddings[np_module.arange(token_embeddings.shape[0]), sequence_lengths]


class ONNXEmbeddingWrapper:
    """Wrap an Optimum ONNX model while reporting the actual provider."""

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
        try:
            return {model_input.name for model_input in self.model.model.get_inputs()}
        except Exception:
            return None

    def encode(
        self,
        texts: list[str],
        normalize_embeddings: bool = True,
        batch_size: int = 8,
        show_progress_bar: bool = False,
    ):
        del show_progress_bar
        all_embeddings = []
        model_input_names = self._get_model_input_names()
        for offset in range(0, len(texts), batch_size):
            batch = texts[offset : offset + batch_size]
            tokens = self.tokenizer(
                batch,
                padding=True,
                truncation=True,
                max_length=self.max_seq_length,
                return_tensors="np",
            )
            self._add_missing_inputs(tokens, model_input_names, len(batch))
            inputs = {key: value for key, value in tokens.items() if key in model_input_names} \
                if model_input_names else dict(tokens)
            outputs = self._run(inputs)
            embeddings = last_token_pool_np(outputs[0], tokens["attention_mask"], self._np)
            if normalize_embeddings:
                norms = self._np.linalg.norm(embeddings, axis=1, keepdims=True)
                embeddings = embeddings / self._np.clip(norms, a_min=1e-9, a_max=None)
            all_embeddings.append(embeddings)
        result = self._np.vstack(all_embeddings) if all_embeddings else self._np.array([])
        import gc

        gc.collect()
        return result

    def _add_missing_inputs(self, tokens, model_input_names, batch_size):
        if not model_input_names:
            return
        if "position_ids" in model_input_names and "position_ids" not in tokens:
            sequence_length = tokens["input_ids"].shape[1]
            tokens["position_ids"] = self._np.tile(
                self._np.arange(sequence_length, dtype=self._np.int64),
                (batch_size, 1),
            )
        past_key_values = [name for name in model_input_names if name.startswith("past_key_values")]
        config = getattr(self.model, "config", None)
        num_heads = getattr(config, "num_key_value_heads", getattr(config, "num_attention_heads", 16))
        head_dimension = getattr(config, "head_dim", 64)
        for name in past_key_values:
            if name not in tokens:
                tokens[name] = self._np.zeros(
                    (batch_size, num_heads, 0, head_dimension),
                    dtype=self._np.float32,
                )

    def _run(self, inputs):
        has_past_key_values = any(key.startswith("past_key_values") for key in inputs)
        try:
            return self._run_once(inputs, has_past_key_values)
        except Exception as error:
            if not self.allow_runtime_cpu_fallback:
                raise
            session = getattr(self.model, "model", None)
            if not hasattr(session, "set_providers"):
                raise
            try:
                session.set_providers(["CPUExecutionProvider"])
                self._record_cpu_fallback(f"{self.provider} batch execution failed: {_error_summary(error)}")
                return self._run_once(inputs, has_past_key_values)
            except Exception:
                raise error

    def _run_once(self, inputs, has_past_key_values):
        session = getattr(self.model, "model", None)
        if has_past_key_values and hasattr(session, "run"):
            output_names = [output.name for output in session.get_outputs()]
            feeds = {
                key: value if isinstance(value, self._np.ndarray) else self._np.asarray(value)
                for key, value in inputs.items()
            }
            return (session.run(output_names, feeds)[0],)
        return self.model(**inputs)

    def _record_cpu_fallback(self, reason: str):
        self.fallback_occurred = True
        self.fallback_reason = reason
        self.selected_backend = "cpu"
        self.provider = "CPUExecutionProvider"
        self.device = "cpu (ONNX Runtime fallback)"

    def to(self, device=None, dtype=None):
        del dtype
        if device == "cpu":
            self._record_cpu_fallback("embedding server moved ONNX Runtime session to CPU")
        return self

    def parameters(self):
        return iter([])

    def health(self) -> BackendHealth:
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
            tokenizer_hash=compute_tokenizer_hash(self.model_name),
            pooling=EMBEDDING_POOLING,
            normalization=EMBEDDING_NORMALIZATION,
            compatibility_group=compatibility_group,
            extra={"executionProvider": self.provider},
        )


def _error_summary(error: Exception) -> str:
    return f"{error.__class__.__name__}: {str(error).replace(chr(10), ' ')[:300]}"
