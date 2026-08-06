"""Apple Neural Engine (ANE) backend client for Swift ANE helper process."""

import json
import os
import subprocess
import sys
from typing import Any
from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash


class AppleANEBackend:
    """Apple Neural Engine (ANE) backend client for Swift ANE helper process."""

    def __init__(self, backend_id: str = "apple-ane", strict: bool = False):
        self.backend_id = backend_id
        self.strict = strict
        self.execution_device = "Apple Neural Engine"
        self.gpu_allowed = False
        self.spec: ModelSpec = ModelSpec()
        self.fallback_occurred = False
        self.fallback_reason: str | None = None
        self.worker_proc: subprocess.Popen[str] | None = None

    def _worker_binary_path(self) -> str:
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base_dir, "apple-ane-worker", ".build", "release", "apple-ane-worker")

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        if sys.platform != "darwin":
            msg = "apple-ane is only supported on macOS arm64"
            if self.strict:
                raise RuntimeError(msg)
            self._setup_cpu_fallback(spec, msg)
            return

        binary_path = self._worker_binary_path()
        if not os.path.exists(binary_path):
            msg = f"Swift ANE worker binary not found at {binary_path}"
            if self.strict:
                raise RuntimeError(msg)
            self._setup_cpu_fallback(spec, msg)
            return

        try:
            self.worker_proc = subprocess.Popen(
                [binary_path],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
            # Send health query
            health_req = json.dumps({"id": "init", "action": "health"}) + "\n"
            if self.worker_proc.stdin:
                self.worker_proc.stdin.write(health_req)
                self.worker_proc.stdin.flush()
                res_line = self.worker_proc.stdout.readline() if self.worker_proc.stdout else ""
                res_data = json.loads(res_line) if res_line else {}
                if res_data.get("status") == "ready":
                    self.execution_device = "Apple Neural Engine"
                    return
        except Exception as error:
            msg = f"Failed to launch Swift ANE worker: {error}"
            if self.strict:
                raise RuntimeError(msg) from error
            self._setup_cpu_fallback(spec, msg)

    def _setup_cpu_fallback(self, spec: ModelSpec, reason: str):
        self.fallback_occurred = True
        self.fallback_reason = reason
        from embedding_backends.torch_backend import PyTorchBackend
        self._fallback_backend = PyTorchBackend("cpu")
        self._fallback_backend.load(spec)
        self.execution_device = "PyTorch CPU (Fallback)"

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        if hasattr(self, "_fallback_backend"):
            return self._fallback_backend.encode(texts, normalize, batch_size)

        if not self.worker_proc or not self.worker_proc.stdin or not self.worker_proc.stdout:
            raise RuntimeError("AppleANEBackend worker process is not active")

        all_embeddings: list[list[float]] = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            req_data = {
                "id": str(i),
                "action": "encode",
                "texts": batch,
                "bucket": 1024,
                "normalize": normalize,
            }
            self.worker_proc.stdin.write(json.dumps(req_data) + "\n")
            self.worker_proc.stdin.flush()

            res_line = self.worker_proc.stdout.readline()
            if not res_line:
                raise RuntimeError("Swift ANE worker process unexpectedly closed standard output")
            res_data = json.loads(res_line)
            if res_data.get("status") != "ok":
                raise RuntimeError(f"Swift ANE worker returned error: {res_data.get('error')}")

            batch_vecs = res_data.get("embeddings", [])
            all_embeddings.extend(batch_vecs)

        return all_embeddings

    def health(self) -> BackendHealth:
        tok_hash = compute_tokenizer_hash(self.spec.model_name)
        compat_group = compute_compatibility_group(
            self.spec.model_name,
            self.spec.dimensions,
            self.spec.pooling,
            self.spec.normalization,
        )
        return BackendHealth(
            status="ready" if (self.worker_proc or hasattr(self, "_fallback_backend")) else "loading",
            requested_backend=self.backend_id,
            selected_backend=self.backend_id if not self.fallback_occurred else "cpu",
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
        if self.worker_proc:
            try:
                self.worker_proc.terminate()
                self.worker_proc.wait(timeout=2)
            except Exception:
                pass
            self.worker_proc = None
        if hasattr(self, "_fallback_backend"):
            self._fallback_backend.close()
