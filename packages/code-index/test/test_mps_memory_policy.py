import unittest
from unittest.mock import Mock

from embedding_runtime_config import EmbeddingRuntimeConfig
from resource_manager import GIB, RuntimePlan
from test_embedding_server import EmbeddingServer


class MpsMemoryPolicyTest(unittest.TestCase):
    def test_default_sequence_length_bounds_mps_attention_memory(self):
        self.assertEqual(EmbeddingRuntimeConfig(device="mps").max_sequence_length, 512)
        self.assertEqual(EmbeddingRuntimeConfig(device="cpu").max_sequence_length, 2048)
        self.assertEqual(
            EmbeddingRuntimeConfig(device="cuda", max_sequence_length=4096).max_sequence_length,
            4096,
        )

    def test_default_mps_precision_is_bfloat16(self):
        self.assertEqual(EmbeddingRuntimeConfig(device="mps").mps_precision, "bfloat16")

    def test_explicit_mps_refuses_cpu_fallback_after_batch_one_oom(self):
        server = EmbeddingServer("test/embed-0.6B")
        server.plan = RuntimePlan(
            usable=True,
            preferred_backend="mps",
            backend="mps",
            device="mps",
            dtype="float32",
            batch_size=1,
            cpu_threads=4,
            model_bytes=2_400_000_000,
            system_reserve_bytes=GIB,
            accelerator_reserve_bytes=GIB,
            reason=None,
        )
        server.fail_closed_backend = True
        server.model = Mock()
        server.model.encode.side_effect = RuntimeError("MPS backend out of memory")
        server._refresh_active_plan = lambda: None
        server._clear_accelerator_cache = Mock()

        with self.assertRaisesRegex(RuntimeError, "batch size 1"):
            server.encode(["chunk"])

        self.assertEqual(server.plan.backend, "mps")
        self.assertIn("refusing CPU fallback after accelerator OOM", server.warnings[0])
        server._clear_accelerator_cache.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
