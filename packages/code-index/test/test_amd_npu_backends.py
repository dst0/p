"""Regression tests for generation-specific AMD NPU backends."""

import json
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import embedding_npu_runtime
from embedding_backends.amd_phoenix_iron_backend import AmdPhoenixIronBackend
from embedding_backends.base import ModelSpec
from embedding_runtime_config import EmbeddingRuntimeConfig, load_embedding_runtime_config


class AmdNpuBackendsTest(unittest.TestCase):
    def test_linux_resolver_distinguishes_phoenix_ryzen_ai_and_intel(self):
        cases = (
            ((True, False, False), "amd-phoenix-npu"),
            ((False, True, False), "amd-ryzenai-npu"),
            ((False, False, True), "openvino"),
        )
        for availability, expected in cases:
            with self.subTest(expected=expected), patch("sys.platform", "linux"), patch(
                "embedding_npu_runtime.phoenix_iron_available",
                return_value=availability[0],
            ), patch(
                "embedding_npu_runtime.vitisai_npu_available",
                return_value=availability[1],
            ), patch(
                "embedding_npu_runtime.openvino_npu_available",
                return_value=availability[2],
            ):
                self.assertEqual(
                    embedding_npu_runtime.resolve_linux_npu_backend("npu"), expected
                )

    def test_generic_npu_requires_explicit_vendor_when_both_are_ready(self):
        with patch("sys.platform", "linux"), patch(
            "embedding_npu_runtime.phoenix_iron_available", return_value=True
        ), patch(
            "embedding_npu_runtime.vitisai_npu_available", return_value=False
        ), patch(
            "embedding_npu_runtime.openvino_npu_available", return_value=True
        ):
            with self.assertRaisesRegex(RuntimeError, "Both AMD and Intel"):
                embedding_npu_runtime.resolve_linux_npu_backend("npu")

    def test_runtime_config_loads_managed_iron_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            config_path = os.path.join(directory, "code-rag.json")
            with open(config_path, "w", encoding="utf-8") as output:
                json.dump(
                    {
                        "amdIronArtifactDirectory": "/managed/artifacts",
                        "amdIronCacheDirectory": "/managed/cache",
                        "amdIronSourceDirectory": "/managed/mlir-aie",
                        "amdNpuGeneration": "npu1",
                    },
                    output,
                )
            config = load_embedding_runtime_config(config_path)
        self.assertEqual(config.amd_iron_artifact_directory, "/managed/artifacts")
        self.assertEqual(config.amd_iron_cache_directory, "/managed/cache")
        self.assertEqual(config.amd_iron_source_directory, "/managed/mlir-aie")
        self.assertEqual(config.amd_npu_generation, "npu1")

    def test_phoenix_backend_rejects_probe_only_manifest(self):
        with tempfile.TemporaryDirectory() as directory:
            runtime = EmbeddingRuntimeConfig(amd_iron_artifact_directory=directory)
            artifact = os.path.join(directory, "Qwen_Qwen3-Embedding-0.6B")
            os.makedirs(artifact)
            with open(os.path.join(artifact, "manifest.json"), "w", encoding="utf-8") as output:
                json.dump(
                    {
                        "deviceGeneration": "npu1",
                        "encoderLayers": 28,
                        "model": "Qwen/Qwen3-Embedding-0.6B",
                        "modelValidated": True,
                        "precision": "bf16",
                        "runtimeModule": "builtin:amd_phoenix_qwen_encoder",
                        "sequenceLengths": [512, 1024, 2048],
                    },
                    output,
                )
            with self.assertRaisesRegex(RuntimeError, "not model-compatible"):
                AmdPhoenixIronBackend(runtime).load(ModelSpec())

    def test_phoenix_backend_reports_full_encoder_dispatch_proof(self):
        required = [
            "attention-scale",
            "attention-softmax",
            "matmul",
            "residual-add",
            "rms-norm",
            "rope",
            "silu",
            "swiglu",
        ]
        with tempfile.TemporaryDirectory() as directory:
            model_path = os.path.join(directory, "model")
            artifact = os.path.join(directory, "artifacts", "Qwen_Qwen3-Embedding-0.6B")
            os.makedirs(model_path)
            os.makedirs(artifact)
            open(os.path.join(model_path, "model.safetensors"), "wb").close()
            manifest = {
                "deviceGeneration": "npu1",
                "dispatchProof": {"operations": required},
                "encoderLayers": 28,
                "model": "Qwen/Qwen3-Embedding-0.6B",
                "modelPath": model_path,
                "modelValidated": True,
                "precision": "bf16",
                "runtimeModule": "builtin:amd_phoenix_qwen_encoder",
                "sequenceLengths": [512, 1024, 2048],
            }
            with open(os.path.join(artifact, "manifest.json"), "w", encoding="utf-8") as output:
                json.dump(manifest, output)
            proof = {
                "deviceGeneration": "npu1",
                "encoderDispatchVerified": True,
                "operations": required,
            }
            encoder = types.SimpleNamespace(
                close=lambda: None,
                dispatch_probe=lambda: proof,
                dispatch_proof=lambda: proof,
                encode=lambda texts, normalize, batch_size: [[1.0] * 1024 for _ in texts],
            )
            module = types.ModuleType("amd_phoenix_qwen_encoder")
            module.create_encoder = lambda spec, loaded_manifest, config: encoder
            runtime = EmbeddingRuntimeConfig(
                amd_iron_artifact_directory=os.path.join(directory, "artifacts"),
                amd_npu_runtime_version="1.4.0",
            )
            with patch.dict(sys.modules, {"amd_phoenix_qwen_encoder": module}):
                backend = AmdPhoenixIronBackend(runtime)
                backend.load(ModelSpec())
                health = backend.health()
        self.assertEqual(health.selected_backend, "amd-phoenix-npu")
        self.assertFalse(health.fallback_occurred)
        self.assertTrue(health.extra["modelValidated"])
        self.assertEqual(health.extra["dispatchProof"], proof)


if __name__ == "__main__":
    unittest.main()
