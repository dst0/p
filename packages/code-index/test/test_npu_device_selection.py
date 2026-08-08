"""Tests for explicit and generic NPU embedding backend selection."""

import os
import sys
import unittest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from test_device_selection import FakeTorchBuilder, _install_fake_torch


class NpuDeviceSelectionTest(unittest.TestCase):
    def setUp(self):
        self.previous_device = os.environ.get("P_CODE_RAG_DEVICE")
        os.environ["P_CODE_RAG_DEVICE"] = "auto"

    def tearDown(self):
        if self.previous_device is None:
            os.environ.pop("P_CODE_RAG_DEVICE", None)
        else:
            os.environ["P_CODE_RAG_DEVICE"] = self.previous_device

    def _server(self):
        return _install_fake_torch(FakeTorchBuilder())("test/model")

    def test_linux_npu_requested_when_unavailable_raises(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._vitisai_npu_available", return_value=False
        ), patch("embedding_server._openvino_npu_available", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "no validated AMD Vitis AI or Intel OpenVINO"):
                server._select_preferred_backend("npu")

    def test_linux_npu_requested_when_available_returns_vendor_backend(self):
        for vitisai_available, openvino_available, expected in (
            (True, False, "vitisai"),
            (False, True, "openvino"),
        ):
            with self.subTest(expected=expected):
                server = self._server()
                with patch("sys.platform", "linux"), patch(
                    "embedding_server._vitisai_npu_available", return_value=vitisai_available
                ), patch(
                    "embedding_server._openvino_npu_available", return_value=openvino_available
                ):
                    backend, _ = server._select_preferred_backend("npu")
                    self.assertEqual(backend, expected)

    def test_linux_npu_with_both_vendors_requires_explicit_backend(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._vitisai_npu_available", return_value=True
        ), patch("embedding_server._openvino_npu_available", return_value=True):
            with self.assertRaisesRegex(RuntimeError, "select ryzenai or intel-openvino-npu explicitly"):
                server._select_preferred_backend("npu")

    def test_macos_npu_uses_real_mps_embeddings(self):
        builder = FakeTorchBuilder()
        builder.mps_available = True
        server = _install_fake_torch(builder)("test/model")
        with patch("sys.platform", "darwin"):
            backend, _ = server._select_preferred_backend("apple-ane")
        self.assertEqual(backend, "mps")
        self.assertTrue(any("using mps" in warning for warning in server.warnings))

    def test_vitisai_requires_execution_provider(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._vitisai_npu_available", return_value=False
        ):
            for device in ("vitisai", "ryzenai"):
                with self.assertRaisesRegex(RuntimeError, "VitisAIExecutionProvider is not available"):
                    server._select_preferred_backend(device)

    def test_vitisai_aliases_select_vitisai(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._vitisai_npu_available", return_value=True
        ):
            for device in ("vitisai", "ryzenai"):
                backend, _ = server._select_preferred_backend(device)
                self.assertEqual(backend, "vitisai")

    def test_intel_openvino_requires_npu_device(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._openvino_npu_available", return_value=False
        ):
            with self.assertRaisesRegex(RuntimeError, "OpenVINO does not expose an NPU"):
                server._select_preferred_backend("intel-openvino-npu")

    def test_intel_openvino_aliases_select_openvino(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._openvino_npu_available", return_value=True
        ):
            for device in ("openvino", "openvino-npu", "intel-openvino-npu"):
                backend, _ = server._select_preferred_backend(device)
                self.assertEqual(backend, "openvino")

    def test_vitisai_availability_depends_on_execution_provider(self):
        import embedding_server

        mock_ort = MagicMock()
        mock_ort.get_available_providers.return_value = ["CPUExecutionProvider"]
        with patch.dict("sys.modules", {"onnxruntime": mock_ort}):
            self.assertFalse(embedding_server._vitisai_npu_available())

        mock_ort.get_available_providers.return_value = [
            "VitisAIExecutionProvider",
            "CPUExecutionProvider",
        ]
        with patch.dict("sys.modules", {"onnxruntime": mock_ort}):
            self.assertTrue(embedding_server._vitisai_npu_available())


if __name__ == "__main__":
    unittest.main()
