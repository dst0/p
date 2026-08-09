"""Tests for explicit and generic NPU embedding backend selection."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from test_device_selection import FakeTorchBuilder, _install_fake_torch


class NpuDeviceSelectionTest(unittest.TestCase):
    def _server(self):
        return _install_fake_torch(FakeTorchBuilder())("test/model")

    def test_linux_npu_selection_uses_generation_aware_resolver(self):
        for requested, resolved in (
            ("npu", "amd-phoenix-npu"),
            ("amd-phoenix-npu", "amd-phoenix-npu"),
            ("amd-ryzenai-npu", "amd-ryzenai-npu"),
            ("intel-openvino-npu", "openvino"),
        ):
            with self.subTest(requested=requested):
                server = self._server()
                with patch("sys.platform", "linux"), patch(
                    "embedding_server._resolve_linux_npu_backend",
                    return_value=resolved,
                ) as resolver:
                    backend, _ = server._select_preferred_backend(requested)
                self.assertEqual(backend, resolved)
                resolver.assert_called_once_with(requested)

    def test_linux_npu_failure_is_not_silently_redirected_to_cpu(self):
        server = self._server()
        with patch("sys.platform", "linux"), patch(
            "embedding_server._resolve_linux_npu_backend",
            side_effect=RuntimeError("runtime validation failed"),
        ):
            with self.assertRaisesRegex(RuntimeError, "runtime validation failed"):
                server._select_preferred_backend("npu")
        self.assertFalse(server.fallback_occurred)

    def test_macos_npu_does_not_masquerade_as_mps(self):
        builder = FakeTorchBuilder()
        builder.mps_available = True
        server = _install_fake_torch(builder)("test/model")
        with patch("sys.platform", "darwin"):
            with self.assertRaisesRegex(RuntimeError, "no verified Qwen CoreML"):
                server._select_preferred_backend("apple-ane")
        self.assertEqual(server.warnings, [])


if __name__ == "__main__":
    unittest.main()
