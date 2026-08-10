"""Tests for native Core AI selection and legacy CoreML routing on Apple Silicon."""

import os
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from embedding_backends.apple_ane_backend import AppleANEBackend
from embedding_backends.apple_coreml_backend import AppleCoreMLBackend
from embedding_backends.base import ModelSpec
from embedding_backends.onnx_backend import ONNXBackend


class AppleNpuBackendsTest(unittest.TestCase):
    def test_macos_27_uses_native_core_ai_worker(self):
        backend = AppleANEBackend()
        with patch("sys.platform", "darwin"), patch(
            "embedding_backends.apple_ane_backend.platform.machine", return_value="arm64"
        ), patch.object(backend, "_core_ai_available", return_value=True), patch.object(
            backend, "_load_core_ai_worker"
        ) as load_worker:
            backend.load(ModelSpec())
        load_worker.assert_called_once_with()

    def test_older_macos_preserves_onnx_coreml_ep_backend(self):
        backend = AppleANEBackend()
        legacy = Mock()
        legacy.execution_device = "NPU (CoreML EP hybrid ANE + CPU)"
        with patch("sys.platform", "darwin"), patch(
            "embedding_backends.apple_ane_backend.platform.machine", return_value="arm64"
        ), patch.object(backend, "_core_ai_available", return_value=False), patch(
            "embedding_backends.apple_ane_backend.AppleCoreMLBackend", return_value=legacy
        ):
            backend.load(ModelSpec())
        legacy.load.assert_called_once()
        self.assertIs(backend.delegate, legacy)

    def test_windowed_core_ai_input_remains_on_ane(self):
        backend = AppleANEBackend()
        backend.worker_health = {"batchSize": 8}
        backend.worker_proc = Mock()
        with patch.object(
            backend,
            "_request",
            return_value={
                "status": "ok",
                "embeddings": [[1.0, 0.0]],
                "windowedInputCount": 1,
            },
        ):
            result = backend.encode(["long input"])
        self.assertEqual(result, [[1.0, 0.0]])
        self.assertTrue(backend.used_windowed_sequence_path)
        self.assertEqual(backend.windowed_input_count, 1)
        health = backend.health()
        self.assertEqual(health.selected_backend, "apple-coreai-ane-windowed")
        self.assertEqual(health.extra["longSequenceNpuRuntime"], "Core AI windowed ANE")
        self.assertEqual(health.extra["windowedInputCount"], 1)

    def test_outdated_core_ai_worker_fails_instead_of_loading_coreml_graph(self):
        backend = AppleANEBackend()
        backend.worker_health = {"batchSize": 8}
        backend.worker_proc = Mock()
        with patch.object(
            backend,
            "_request",
            return_value={"status": "unsupported_length", "maxSequenceLength": 64},
        ):
            with self.assertRaisesRegex(RuntimeError, "reinstall p"):
                backend.encode(["long input"])

    def test_recycles_core_ai_worker_before_native_pool_exhaustion(self):
        backend = AppleANEBackend()
        backend.worker_health = {"batchSize": 8}
        backend.worker_proc = Mock()
        with patch.object(
            backend,
            "_request",
            return_value={
                "status": "ok",
                "embeddings": [[1.0, 0.0]],
                "inferenceWindowCount": 32,
                "recycleRecommended": True,
            },
        ), patch.object(backend, "_restart_core_ai_worker") as restart:
            result = backend.encode(["long input"])
        self.assertEqual(result, [[1.0, 0.0]])
        self.assertEqual(backend.inference_window_count, 32)
        restart.assert_called_once_with()

    def test_restarts_dead_core_ai_worker_and_retries_request_once(self):
        backend = AppleANEBackend()
        backend.worker_health = {"batchSize": 8}
        backend.worker_proc = Mock()
        backend.worker_proc.poll.return_value = 1
        with patch.object(
            backend,
            "_request",
            side_effect=[
                RuntimeError("Core AI worker exited unexpectedly"),
                {"status": "ok", "embeddings": [[1.0, 0.0]]},
            ],
        ), patch.object(backend, "_restart_core_ai_worker") as restart:
            result = backend.encode(["query"])
        self.assertEqual(result, [[1.0, 0.0]])
        restart.assert_called_once_with()

    def test_health_reports_dead_core_ai_worker_as_error(self):
        backend = AppleANEBackend()
        backend.worker_proc = Mock()
        backend.worker_proc.poll.return_value = 1

        health = backend.health()

        self.assertEqual(health.status, "error")
        self.assertFalse(health.extra["workerProcessAlive"])
        self.assertFalse(health.extra["npuFullyPlaced"])

    def test_legacy_coreml_limits_dynamic_qwen_graph_to_batch_one(self):
        backend = AppleCoreMLBackend()
        with patch.object(
            ONNXBackend,
            "encode",
            return_value=[[1.0], [2.0]],
        ) as encode:
            result = backend.encode(["one", "two"], batch_size=8)
        self.assertEqual(result, [[1.0], [2.0]])
        encode.assert_called_once_with(["one", "two"], True, 1)


if __name__ == "__main__":
    unittest.main()
