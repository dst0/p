#!/usr/bin/env python3
"""JSONL worker that executes Qwen embeddings on the Apple Neural Engine."""

import argparse
import asyncio
import gc
import json
import os
import plistlib
import sys
from pathlib import Path
from typing import Any

os.environ.setdefault("USE_OS_COREAI", "1")

import numpy as np
from coreai.runtime import (
    AIModel,
    ComputeUnitKind,
    NDArray,
    Profiler,
    SpecializationOptions,
)
from transformers import AutoTokenizer

from apple_coreai_windowing import iter_token_windows, pool_window_vectors


MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
HEAD_DIMENSION = 128
ROPE_THETA = 1_000_000.0
WORKER_WINDOW_BUDGET = 1024
GC_WINDOW_INTERVAL = 64


class AppleCoreAIWorker:
    """Own the Core AI model, verify ANE residency, and serve embedding requests."""

    def __init__(self, artifact_root: Path) -> None:
        self.artifact_root = artifact_root
        self.request_batch_size = 8
        self.compiled_batch_size = 1
        self.sequence_length = 64
        self.embedding_table: np.ndarray | None = None
        self.function: Any = None
        self.model: Any = None
        self.model_package: Path | None = None
        self.residency_verified = False
        self.windowed_input_count = 0
        self.inference_window_count = 0
        self.rope_cos, self.rope_sin = self._make_rope()
        self.causal_mask = self._make_causal_mask()

    async def initialize(self) -> None:
        marker = json.loads((self.artifact_root / "current.json").read_text())
        artifact = self.artifact_root / marker["artifactVersion"]
        metadata = json.loads((artifact / "artifact.json").read_text())
        self.compiled_batch_size = int(metadata["batchSize"])
        if self.compiled_batch_size != 1:
            raise RuntimeError("Core AI fast-path asset must use a compiled batch size of 1")
        self.sequence_length = int(metadata["sequenceLength"])
        self.rope_cos, self.rope_sin = self._make_rope()
        self.causal_mask = self._make_causal_mask()
        self.embedding_table = np.load(artifact / "embedding-table.npy", mmap_mode="r")
        tokenizer = AutoTokenizer.from_pretrained(artifact / "tokenizer")
        tokenizer.padding_side = "right"
        self.tokenizer = tokenizer
        events: list[dict[str, Any]] = []

        def begin(event):
            events.append({"event": str(event.event_id), "metadata": event.metadata})
            return len(events)

        def end(_event, _interval_id):
            return None

        options = SpecializationOptions.from_preferred_compute_unit_kind(
            ComputeUnitKind.neural_engine()
        ).with_debug(enabled=True)
        self.model = await AIModel.load(artifact / "model.aimodel", options)
        function_names = list(self.model.function_names)
        if len(function_names) != 1:
            raise RuntimeError(f"Expected one Core AI embedding function, found {function_names}")
        self.function = self.model.load_function(
            function_names[0],
            profiler=Profiler(on_log_event_begin=begin, on_log_event_end=end),
        )
        await self._infer(["Core AI ANE residency probe"])
        package = next(
            (
                event["metadata"].get("modelPackage")
                for event in events
                if isinstance(event.get("metadata"), dict)
                and event["metadata"].get("modelPackage")
            ),
            None,
        )
        if not package:
            raise RuntimeError("Core AI profiler did not report the compiled model package")
        self.model_package = Path(package)
        self.residency_verified = self._verify_ane_manifest(self.model_package)
        if not self.residency_verified:
            raise RuntimeError("Core AI compiled graph is not fully placed on ANE without GPU activity")

    async def _infer(self, texts: list[str], normalize: bool = True) -> list[list[float]]:
        if self.embedding_table is None or self.function is None:
            raise RuntimeError("Core AI worker is not initialized")
        if not texts or len(texts) > self.request_batch_size:
            raise ValueError(f"Core AI batch must contain 1-{self.request_batch_size} texts")
        results = []
        for text in texts:
            results.append(await self._infer_one(text, normalize))
        return results

    async def _infer_one(self, text: str, normalize: bool) -> list[float]:
        if self.embedding_table is None or self.function is None:
            raise RuntimeError("Core AI worker is not initialized")
        tokens = self.tokenizer(
            [text],
            padding=False,
            truncation=False,
            return_tensors="np",
        )
        token_ids = tokens["input_ids"][0]
        if len(token_ids) > self.sequence_length:
            self.windowed_input_count += 1
        windows = list(iter_token_windows(token_ids, self.sequence_length))
        values = pool_window_vectors(
            [await self._infer_window(window) for window in windows],
            [len(window) for window in windows],
            normalize,
        )
        return values.tolist()

    async def _infer_window(self, token_ids: np.ndarray) -> np.ndarray:
        if self.embedding_table is None or self.function is None:
            raise RuntimeError("Core AI worker is not initialized")
        padded = np.full(
            (self.compiled_batch_size, self.sequence_length),
            self.tokenizer.pad_token_id,
            dtype=token_ids.dtype,
        )
        padded[0, : len(token_ids)] = token_ids
        token_embeddings = np.ascontiguousarray(
            self.embedding_table[padded].astype(np.float16)
        )
        arrays = {
            "token_embeddings": token_embeddings.reshape(
                self.compiled_batch_size, self.sequence_length, 1, -1
            ),
            "rope_cos": self.rope_cos,
            "rope_sin": self.rope_sin,
            "causal_mask": self.causal_mask,
        }
        inputs = {
            name: NDArray(data=np.ascontiguousarray(value)) for name, value in arrays.items()
        }
        output = await self.function(inputs)
        output_array = output["hidden_states"].numpy()
        hidden = np.array(output_array, dtype=np.float32, copy=True)
        values = hidden[0, len(token_ids) - 1, 0, :].copy()
        del output_array, output, inputs, hidden
        self.inference_window_count += 1
        if self.inference_window_count % GC_WINDOW_INTERVAL == 0:
            gc.collect()
        return values

    async def serve(self) -> None:
        await self.initialize()
        while True:
            line = await asyncio.to_thread(sys.stdin.readline)
            if not line:
                return
            request: dict[str, Any] = {}
            try:
                request = json.loads(line)
                if request.get("action") == "health":
                    response = self._health_response(request.get("id"))
                elif request.get("action") == "encode":
                    texts = list(request.get("texts", []))
                    previous_windowed_count = self.windowed_input_count
                    previous_inference_count = self.inference_window_count
                    embeddings = await self._infer(
                        texts, bool(request.get("normalize", True))
                    )
                    response = {
                        "id": request.get("id"),
                        "status": "ok",
                        "embeddings": embeddings,
                        "windowedInputCount": self.windowed_input_count
                        - previous_windowed_count,
                        "inferenceWindowCount": self.inference_window_count
                        - previous_inference_count,
                        "recycleRecommended": self.inference_window_count
                        >= WORKER_WINDOW_BUDGET,
                    }
                else:
                    raise ValueError(f"Unknown worker action: {request.get('action')}")
            except Exception as error:
                response = {
                    "id": request.get("id"),
                    "status": "error",
                    "error": f"{error.__class__.__name__}: {error}",
                }
            print(json.dumps(response), flush=True)

    def _health_response(self, request_id: Any) -> dict[str, Any]:
        return {
            "id": request_id,
            "status": "ready",
            "runtime": "Core AI",
            "executionDevice": "NPU (Apple Neural Engine via Core AI)",
            "preferredComputeUnit": "Neural Engine",
            "availableComputeUnits": [str(kind) for kind in ComputeUnitKind.available_kinds()],
            "npuFullyPlaced": self.residency_verified,
            "gpuActivity": False,
            "batchSize": self.request_batch_size,
            "compiledBatchSize": self.compiled_batch_size,
            "sequenceLength": self.sequence_length,
            "longSequenceStrategy": "weighted mean of full-ANE windows",
            "windowedInputCount": self.windowed_input_count,
            "inferenceWindowCount": self.inference_window_count,
            "workerWindowBudget": WORKER_WINDOW_BUDGET,
        }

    def _make_rope(self) -> tuple[np.ndarray, np.ndarray]:
        theta = 1.0 / (
            ROPE_THETA
            ** (np.arange(0, HEAD_DIMENSION, 2, dtype=np.float32) / HEAD_DIMENSION)
        )
        frequencies = np.arange(self.sequence_length, dtype=np.float32)[:, None] * theta
        embeddings = np.concatenate((frequencies, frequencies), axis=-1)
        return (
            np.cos(embeddings).astype(np.float16)[None, :, :],
            np.sin(embeddings).astype(np.float16)[None, :, :],
        )

    def _make_causal_mask(self) -> np.ndarray:
        keys = np.arange(self.sequence_length)[:, None]
        queries = np.arange(self.sequence_length)[None, :]
        mask = np.zeros((self.sequence_length, self.sequence_length), dtype=np.float16)
        mask[keys > queries] = -40000.0
        return mask[None, :, None, :]

    @staticmethod
    def _verify_ane_manifest(model_package: Path) -> bool:
        manifests = list(model_package.rglob("manifest.plist"))
        for manifest_path in manifests:
            with manifest_path.open("rb") as handle:
                manifest = plistlib.load(handle)
            rendered = repr(manifest)
            if (
                "ANERegionsHash" in rendered
                and "mps.fullyPlacedOnANE" in rendered
                and "mps.noGPUActivity" in rendered
                and "'GPU adapter present': 'NO'" in rendered
            ):
                return True
        return False


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-root", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(AppleCoreAIWorker(args.artifact_root).serve())


if __name__ == "__main__":
    main()
