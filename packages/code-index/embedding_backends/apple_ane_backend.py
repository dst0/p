"""Apple NPU backend using Core AI or the legacy ONNX Runtime CoreML EP."""

import json
import os
import platform
import select
import subprocess
import sys
import threading
from collections import deque
from typing import Any

from embedding_backends.apple_coreml_backend import AppleCoreMLBackend
from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import compute_compatibility_group, compute_tokenizer_hash


class AppleANEBackend:
    """Select native Core AI on macOS 27+ and CoreML EP on older macOS."""

    def __init__(self, backend_id: str = "apple-ane", strict: bool = True):
        self.backend_id = backend_id
        self.strict = strict
        self.execution_device = "NPU (Apple Neural Engine)"
        self.gpu_allowed = False
        self.spec = ModelSpec()
        self.worker_proc: subprocess.Popen[str] | None = None
        self.worker_health: dict[str, Any] = {}
        self.stderr_lines: deque[str] = deque(maxlen=20)
        self.delegate: AppleCoreMLBackend | None = None
        self.used_windowed_sequence_path = False
        self.windowed_input_count = 0
        self.max_seq_length = 2048

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        if sys.platform != "darwin" or platform.machine() != "arm64":
            raise RuntimeError("apple-ane requires an Apple Silicon Mac")
        if self._core_ai_available():
            self._load_core_ai_worker()
            return
        self.delegate = AppleCoreMLBackend(self.backend_id, strict=True)
        self.delegate.load(spec)
        self.execution_device = self.delegate.execution_device
        self.max_seq_length = spec.sequence_length

    def _load_core_ai_worker(self) -> None:
        agent = os.environ.get("P_CODING_AGENT_DIR", os.path.expanduser("~/.p/agent"))
        service_root = os.path.join(agent, "indexing-service")
        python = os.environ.get(
            "P_APPLE_COREAI_PYTHON",
            os.path.join(service_root, "coreai-venv", "bin", "python"),
        )
        artifact_root = os.environ.get(
            "P_APPLE_COREAI_ARTIFACT_ROOT",
            os.path.join(service_root, "apple-coreai"),
        )
        worker = os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
            "apple_coreai_worker.py",
        )
        if not os.path.isfile(python) or not os.path.isfile(os.path.join(artifact_root, "current.json")):
            raise RuntimeError("Core AI NPU runtime or Qwen ANE artifact is not installed")
        environment = {**os.environ, "USE_OS_COREAI": "1"}
        self.worker_proc = subprocess.Popen(
            [python, worker, "--artifact-root", artifact_root],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            env=environment,
        )
        if self.worker_proc.stderr:
            threading.Thread(
                target=self._drain_stderr,
                args=(self.worker_proc.stderr,),
                daemon=True,
            ).start()
        self.worker_health = self._request({"id": "init", "action": "health"}, timeout=600)
        if self.worker_health.get("status") != "ready":
            raise RuntimeError(f"Core AI worker failed health check: {self.worker_health}")
        if not self.worker_health.get("npuFullyPlaced") or self.worker_health.get("gpuActivity"):
            raise RuntimeError("Core AI worker did not prove full ANE placement with no GPU activity")
        self.execution_device = str(self.worker_health["executionDevice"])

    def _drain_stderr(self, stream) -> None:
        for line in stream:
            self.stderr_lines.append(line.rstrip())

    def _request(self, request: dict[str, Any], timeout: float = 120) -> dict[str, Any]:
        process = self.worker_proc
        if not process or not process.stdin or not process.stdout:
            raise RuntimeError("Core AI worker is not active")
        process.stdin.write(json.dumps(request) + "\n")
        process.stdin.flush()
        ready, _, _ = select.select([process.stdout], [], [], timeout)
        if not ready:
            details = "; ".join(self.stderr_lines)
            raise RuntimeError(f"Core AI worker timed out{': ' + details if details else ''}")
        line = process.stdout.readline()
        if not line:
            details = "; ".join(self.stderr_lines)
            raise RuntimeError(f"Core AI worker exited unexpectedly{': ' + details if details else ''}")
        response = json.loads(line)
        if response.get("status") == "error":
            raise RuntimeError(f"Core AI worker error: {response.get('error')}")
        return response

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
    ) -> list[list[float]]:
        if self.delegate:
            return self.delegate.encode(texts, normalize, batch_size)
        embeddings: list[list[float]] = []
        worker_batch = int(self.worker_health.get("batchSize", 8))
        effective_batch = max(1, min(batch_size, worker_batch))
        for offset in range(0, len(texts), effective_batch):
            response = self._request(
                {
                    "id": str(offset),
                    "action": "encode",
                    "texts": texts[offset : offset + effective_batch],
                    "normalize": normalize,
                }
            )
            if response.get("status") == "unsupported_length":
                raise RuntimeError(
                    "Installed Core AI worker lacks bounded long-sequence support; "
                    "reinstall p instead of loading the memory-heavy CoreML graph"
                )
            if response.get("windowedInputCount", 0) > 0:
                self.used_windowed_sequence_path = True
                self.windowed_input_count += int(response["windowedInputCount"])
            embeddings.extend(response.get("embeddings", []))
        return embeddings

    def health(self) -> BackendHealth:
        if self.delegate:
            return self.delegate.health()
        compatibility = compute_compatibility_group(
            self.spec.model_name,
            self.spec.dimensions,
            self.spec.pooling,
            self.spec.normalization,
        )
        return BackendHealth(
            status="ready" if self.worker_proc else "loading",
            requested_backend=self.backend_id,
            selected_backend=(
                "apple-coreai-ane-windowed"
                if self.used_windowed_sequence_path
                else "apple-coreai-ane"
            ),
            execution_device=self.execution_device,
            gpu_allowed=False,
            fallback_occurred=False,
            model_name=self.spec.model_name,
            dimensions=self.spec.dimensions,
            tokenizer_hash=compute_tokenizer_hash(self.spec.model_name),
            pooling=self.spec.pooling,
            normalization=self.spec.normalization,
            compatibility_group=compatibility,
            batch_size=int(self.worker_health.get("batchSize", 8)),
            extra={
                "npuRuntime": self.worker_health.get("runtime", "Core AI"),
                "npuPlacement": (
                    "full ANE windowed path"
                    if self.used_windowed_sequence_path else "full ANE fast path"
                ),
                "npuFullyPlaced": True,
                "gpuActivity": False,
                "coreAiWindowSize": self.worker_health.get("sequenceLength", 64),
                "longSequenceStrategy": self.worker_health.get(
                    "longSequenceStrategy", "weighted mean of full-ANE windows"
                ),
                "longSequenceNpuRuntime": "Core AI windowed ANE",
                "windowedInputCount": self.windowed_input_count,
            },
        )

    def close(self) -> None:
        if self.delegate:
            self.delegate.close()
            self.delegate = None
        if self.worker_proc:
            self.worker_proc.terminate()
            try:
                self.worker_proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                self.worker_proc.kill()
            self.worker_proc = None

    @staticmethod
    def _core_ai_available() -> bool:
        version = platform.mac_ver()[0]
        try:
            return int(version.split(".", 1)[0]) >= 27
        except (TypeError, ValueError):
            return False

    @staticmethod
    def core_ai_runtime_installed() -> bool:
        agent = os.environ.get("P_CODING_AGENT_DIR", os.path.expanduser("~/.p/agent"))
        service_root = os.path.join(agent, "indexing-service")
        python = os.environ.get(
            "P_APPLE_COREAI_PYTHON",
            os.path.join(service_root, "coreai-venv", "bin", "python"),
        )
        artifact_root = os.environ.get(
            "P_APPLE_COREAI_ARTIFACT_ROOT",
            os.path.join(service_root, "apple-coreai"),
        )
        return os.path.isfile(python) and os.path.isfile(os.path.join(artifact_root, "current.json"))
