import os
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from embedding_backends.base import ModelSpec
from embedding_backends.openvino_backend import OpenVINOBackend


class FakeOVSentenceTransformer:
    selected_device = "NPU"
    calls = []

    @classmethod
    def from_pretrained(cls, model_name, **options):
        cls.calls.append((model_name, options))
        model = cls()
        model.device = cls.selected_device
        return model

    def encode(self, texts, **_options):
        return [[float(index), 1.0] for index, _text in enumerate(texts)]


def fake_optimum_modules():
    optimum = types.ModuleType("optimum")
    optimum_intel = types.ModuleType("optimum.intel")
    optimum_intel.OVSentenceTransformer = FakeOVSentenceTransformer
    optimum.intel = optimum_intel
    return {"optimum": optimum, "optimum.intel": optimum_intel}


class OpenVINOBackendTest(unittest.TestCase):
    def setUp(self):
        FakeOVSentenceTransformer.calls = []
        FakeOVSentenceTransformer.selected_device = "NPU"

    def test_strict_npu_backend_compiles_for_npu_with_a_persistent_cache(self):
        backend = OpenVINOBackend("intel-openvino-npu", strict=True)
        with patch.dict(sys.modules, fake_optimum_modules()), patch.dict(
            os.environ,
            {"P_CODE_RAG_OPENVINO_CACHE_DIR": "/tmp/p-openvino-test-cache"},
            clear=False,
        ):
            backend.load(ModelSpec(model_name="test/model", dimensions=2))

        self.assertEqual(backend.execution_device, "Intel OpenVINO NPU")
        self.assertEqual(
            FakeOVSentenceTransformer.calls,
            [
                (
                    "test/model",
                    {
                        "device": "NPU",
                        "export": True,
                        "ov_config": {"CACHE_DIR": "/tmp/p-openvino-test-cache"},
                    },
                )
            ],
        )
        self.assertEqual(backend.encode(["one", "two"], batch_size=2), [[0.0, 1.0], [1.0, 1.0]])

    def test_strict_npu_backend_rejects_an_unexpected_cpu_compilation(self):
        FakeOVSentenceTransformer.selected_device = "CPU"
        backend = OpenVINOBackend("intel-openvino-npu", strict=True)

        with patch.dict(sys.modules, fake_optimum_modules()):
            with self.assertRaisesRegex(RuntimeError, "not NPU"):
                backend.load(ModelSpec(model_name="test/model", dimensions=2))


if __name__ == "__main__":
    unittest.main()
