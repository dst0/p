"""Tests for _select_preferred_backend device mismatch handling.

When P_CODE_RAG_DEVICE=cuda is set but ROCm is detected (or vice versa),
the server should fall back to CPU with a warning, not silently accept
the wrong accelerator. Same for explicit mps when MPS is unavailable.
"""
import os
import sys

# Ensure the parent directory (packages/code-index) is on the path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import types
import unittest

# -- fake torch with configurable accelerator detection ------------------

class ConfigurableAccelerator:
    """Fake accelerator backend that can be toggled on/off."""

    def __init__(self, available=True):
        self._available = available

    def is_available(self):
        return self._available

    def empty_cache(self):
        pass

    @staticmethod
    def mem_get_info():
        return (8 * 1024**3, 16 * 1024**3)  # 8 GiB free, 16 GiB total


class FakeTorchBuilder:
    """Build a fake torch module with specific accelerator state."""

    def __init__(self):
        self.cuda_available = False
        self.hip_version = None  # None = not ROCm
        self.cuda_version = None
        self.mps_available = False

    def build(self):
        fake = types.ModuleType("torch")
        fake.__version__ = "2.0.0+fake"
        fake.cuda = ConfigurableAccelerator(self.cuda_available)
        fake.mps = ConfigurableAccelerator(self.mps_available)
        fake.backends = types.SimpleNamespace(
            mps=ConfigurableAccelerator(self.mps_available)
        )
        fake.version = types.SimpleNamespace(
            cuda=self.cuda_version, hip=self.hip_version
        )
        fake.float16 = "float16"
        fake.float32 = "float32"
        fake.get_num_threads = lambda: 1
        fake.set_num_threads = lambda _threads: None
        fake.inference_mode = lambda: _ContextManager()
        return fake


class _ContextManager:
    def __enter__(self):
        return self
    def __exit__(self, *args):
        pass


def _install_fake_torch(builder: FakeTorchBuilder):
    fake = builder.build()
    sys.modules["torch"] = fake
    if "sentence_transformers" not in sys.modules:
        fake_st = types.ModuleType("sentence_transformers")
        fake_st.SentenceTransformer = object
        sys.modules["sentence_transformers"] = fake_st
    # Re-import the module so it picks up the new torch
    if "embedding_server" in sys.modules:
        del sys.modules["embedding_server"]
    from embedding_server import EmbeddingServer
    return EmbeddingServer


class DeviceSelectionTest(unittest.TestCase):
    """Verify explicit device requests are not silently redirected."""

    def setUp(self):
        self.previous_device = os.environ.get("P_CODE_RAG_DEVICE")
        os.environ["P_CODE_RAG_DEVICE"] = "auto"

    def tearDown(self):
        if self.previous_device is None:
            os.environ.pop("P_CODE_RAG_DEVICE", None)
        else:
            os.environ["P_CODE_RAG_DEVICE"] = self.previous_device
    # -- CUDA requested, ROCm detected ----------------------------------

    def test_cuda_requested_rocm_detected_falls_back_to_cpu(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.hip_version = "6.0"  # ROCm build
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("cuda")

        self.assertEqual(backend, "cpu")
        self.assertIn(
            "requested cuda backend is unavailable; using CPU",
            server.warnings,
        )

    # -- ROCm requested, CUDA detected ----------------------------------

    def test_rocm_requested_cuda_detected_falls_back_to_cpu(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.hip_version = None  # CUDA build (no HIP)
        builder.cuda_version = "12.4"
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("rocm")

        self.assertEqual(backend, "cpu")
        self.assertIn(
            "requested rocm backend is unavailable; using CPU",
            server.warnings,
        )

    # -- CUDA requested, CUDA detected (happy path) ---------------------

    def test_cuda_requested_cuda_detected_uses_cuda(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.cuda_version = "12.4"
        builder.hip_version = None
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("cuda")

        self.assertEqual(backend, "cuda")

    # -- ROCm requested, ROCm detected (happy path) ---------------------

    def test_rocm_requested_rocm_detected_uses_rocm(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.hip_version = "6.0"
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("rocm")

        self.assertEqual(backend, "rocm")

    # -- auto with ROCm detected ----------------------------------------

    def test_auto_with_rocm_detected_uses_rocm(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.hip_version = "6.0"
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("auto")

        self.assertEqual(backend, "rocm")

    # -- auto with CUDA detected ----------------------------------------

    def test_auto_with_cuda_detected_uses_cuda(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.cuda_version = "12.4"
        builder.hip_version = None
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("auto")

        self.assertEqual(backend, "cuda")

    # -- MPS requested, no MPS detected ---------------------------------

    def test_mps_requested_no_mps_detected_falls_back_to_cpu(self):
        builder = FakeTorchBuilder()
        builder.mps_available = False
        builder.cuda_available = False
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("mps")

        self.assertEqual(backend, "cpu")
        self.assertIn(
            "requested mps backend is unavailable; using CPU",
            server.warnings,
        )

    # -- MPS requested, MPS detected (happy path) -----------------------

    def test_mps_requested_mps_detected_uses_mps(self):
        builder = FakeTorchBuilder()
        builder.mps_available = True
        builder.cuda_available = False
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("mps")

        self.assertEqual(backend, "mps")

    # -- CPU requested always returns CPU -------------------------------

    def test_cpu_requested_always_returns_cpu(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = True
        builder.cuda_version = "12.4"
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        backend, _ = server._select_preferred_backend("cpu")

        self.assertEqual(backend, "cpu")

    # -- auto with no accelerator detected ------------------------------

    def test_auto_with_no_accelerator_returns_cpu(self):
        builder = FakeTorchBuilder()
        builder.cuda_available = False
        builder.mps_available = False
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        from unittest.mock import patch
        with patch.dict("os.environ", {}, clear=False):
            os.environ.pop("P_CODE_RAG_DEVICE", None)
            backend, _ = server._select_preferred_backend("auto")

        self.assertEqual(backend, "cpu")

    # -- NPU requested when unavailable falls back to CPU --------------

    def test_npu_requested_when_unavailable_falls_back_to_cpu(self):
        builder = FakeTorchBuilder()
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        from unittest.mock import patch
        with patch("sys.platform", "linux"), patch("embedding_server._npu_available", return_value=False):
            for dev in ("npu", "openvino", "coreml", "vitisai"):
                backend, _ = server._select_preferred_backend(dev)
                self.assertEqual(backend, "cpu")
                self.assertIn(f"requested {dev} backend is unavailable; using CPU", server.warnings)

    def test_npu_requested_when_available_returns_npu_device(self):
        builder = FakeTorchBuilder()
        EmbeddingServer = _install_fake_torch(builder)

        server = EmbeddingServer("test/model")

        from unittest.mock import patch
        with patch("sys.platform", "linux"), patch("embedding_server._npu_available", return_value=True):
            for dev in ("npu", "openvino", "coreml", "vitisai"):
                backend, _ = server._select_preferred_backend(dev)
                self.assertEqual(backend, dev)

    def test_vitisai_npu_available_requires_execution_provider(self):
        from unittest.mock import MagicMock, patch
        import embedding_server

        mock_ort = MagicMock()
        mock_ort.get_available_providers.return_value = ["CPUExecutionProvider"]
        with patch.dict("sys.modules", {"onnxruntime": mock_ort}):
            self.assertFalse(embedding_server._vitisai_npu_available())

        mock_ort_with_vitis = MagicMock()
        mock_ort_with_vitis.get_available_providers.return_value = ["VitisAIExecutionProvider", "CPUExecutionProvider"]
        with patch.dict("sys.modules", {"onnxruntime": mock_ort_with_vitis}):
            self.assertTrue(embedding_server._vitisai_npu_available())


if __name__ == "__main__":
    unittest.main()
