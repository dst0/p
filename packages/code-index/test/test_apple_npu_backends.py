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

    def test_long_core_ai_input_routes_to_legacy_coreml_without_gpu(self):
        backend = AppleANEBackend()
        backend.worker_health = {"batchSize": 8}
        backend.worker_proc = Mock()
        legacy = Mock()
        legacy.encode.return_value = [[1.0, 0.0]]
        with patch.object(
            backend,
            "_request",
            return_value={"status": "unsupported_length", "maxSequenceLength": 64},
        ), patch.object(backend, "_load_long_sequence_delegate", return_value=legacy):
            result = backend.encode(["long input"])
        self.assertEqual(result, [[1.0, 0.0]])
        self.assertTrue(backend.used_long_sequence_path)
        legacy.encode.assert_called_once_with(["long input"], True, 8)

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
