import os
import sys
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from embedding_backends.base import ModelSpec
from embedding_backends.openvino_backend import OpenVINOBackend

fake_state = {"selected_device": "NPU", "calls": []}


def fake_optimum_modules():
    def from_pretrained(model_name, **options):
        fake_state["calls"].append((model_name, options))
        return types.SimpleNamespace(
            device=fake_state["selected_device"],
            encode=lambda texts, **_options: [
                [float(index), 1.0] for index, _text in enumerate(texts)
            ],
        )

    optimum = types.ModuleType("optimum")
    optimum_intel = types.ModuleType("optimum.intel")
    optimum_intel.OVSentenceTransformer = types.SimpleNamespace(
        from_pretrained=from_pretrained
    )
    optimum.intel = optimum_intel
    return {"optimum": optimum, "optimum.intel": optimum_intel}


class OpenVINOBackendTest(unittest.TestCase):
    def setUp(self):
        fake_state["calls"] = []
        fake_state["selected_device"] = "NPU"

    def test_strict_npu_compiles_for_npu_with_a_persistent_cache(self):
        backend = OpenVINOBackend(
            "intel-openvino-npu",
            strict=True,
            cache_directory="/tmp/p-openvino-test-cache",
        )
        with patch.dict(sys.modules, fake_optimum_modules()):
            backend.load(ModelSpec(model_name="test/model", dimensions=2))

        self.assertEqual(backend.execution_device, "Intel OpenVINO NPU")
        self.assertEqual(
            fake_state["calls"],
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
        self.assertEqual(
            backend.encode(["one", "two"], batch_size=2),
            [[0.0, 1.0], [1.0, 1.0]],
        )

    def test_strict_npu_rejects_an_unexpected_cpu_compilation(self):
        fake_state["selected_device"] = "CPU"
        backend = OpenVINOBackend("intel-openvino-npu", strict=True)
        with patch.dict(sys.modules, fake_optimum_modules()):
            with self.assertRaisesRegex(RuntimeError, "not NPU"):
                backend.load(ModelSpec(model_name="test/model", dimensions=2))


if __name__ == "__main__":
    unittest.main()
