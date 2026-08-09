"""Legacy Apple Neural Engine path through ONNX Runtime's CoreML EP."""

import os

from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash
from embedding_backends.onnx_backend import ONNXBackend


class AppleCoreMLBackend(ONNXBackend):
    """Run supported Qwen subgraphs on ANE and unsupported operators on CPU."""

    def __init__(self, backend_id: str = "apple-ane", strict: bool = True):
        super().__init__(backend_id, strict)
        self.execution_device = "NPU (CoreML EP hybrid ANE + CPU)"
        self.provider = "CoreMLExecutionProvider"

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        import numpy as np
        import onnxruntime as ort
        from transformers import AutoTokenizer

        if "CoreMLExecutionProvider" not in ort.get_available_providers():
            raise RuntimeError("ONNX Runtime CoreMLExecutionProvider is unavailable")
        self._np = np
        cache = os.path.expanduser(
            f"~/.p/agent/indexing-service/onnx-cache/{spec.model_name.replace('/', '_')}"
        )
        coreml_cache = os.path.join(cache, "coreml-neuralnetwork")
        os.makedirs(coreml_cache, exist_ok=True)
        model_path = os.path.join(cache, "model.onnx")
        if not os.path.exists(model_path):
            bootstrap = ONNXBackend("onnx-cpu", strict=True)
            bootstrap.load(spec)
            bootstrap.close()
        self.tokenizer = AutoTokenizer.from_pretrained(spec.model_name)
        options = ort.SessionOptions()
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        options.intra_op_num_threads = 4
        self.session = ort.InferenceSession(
            model_path,
            sess_options=options,
            providers=[
                (
                    "CoreMLExecutionProvider",
                    {
                        "MLComputeUnits": "CPUAndNeuralEngine",
                        "ModelFormat": "NeuralNetwork",
                        "RequireStaticInputShapes": "0",
                        "EnableOnSubgraphs": "0",
                        "ModelCacheDirectory": coreml_cache,
                    },
                ),
                "CPUExecutionProvider",
            ],
        )

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        del batch_size
        return super().encode(texts, normalize, 1)

    def health(self) -> BackendHealth:
        compatibility = compute_compatibility_group(
            self.spec.model_name,
            self.spec.dimensions,
            self.spec.pooling,
            self.spec.normalization,
        )
        return BackendHealth(
            status="ready" if hasattr(self, "session") else "loading",
            requested_backend=self.backend_id,
            selected_backend="apple-coreml",
            execution_device=self.execution_device,
            gpu_allowed=False,
            fallback_occurred=False,
            model_name=self.spec.model_name,
            dimensions=self.spec.dimensions,
            tokenizer_hash=compute_tokenizer_hash(self.spec.model_name),
            pooling=self.spec.pooling,
            normalization=self.spec.normalization,
            compatibility_group=compatibility,
            extra={
                "executionProvider": self.provider,
                "npuRuntime": "ONNX Runtime CoreML EP",
                "npuPlacement": "hybrid ANE + CPU",
                "npuFullyPlaced": False,
                "gpuActivity": False,
            },
        )
