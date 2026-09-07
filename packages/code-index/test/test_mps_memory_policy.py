import unittest
from unittest.mock import Mock

from embedding_runtime_config import EmbeddingRuntimeConfig
from resource_manager import GIB, MemorySnapshot, RuntimePlan
from test_embedding_server import EmbeddingServer


class MpsMemoryPolicyTest(unittest.TestCase):
    def test_default_sequence_length_bounds_mps_attention_memory(self):
        self.assertEqual(EmbeddingRuntimeConfig(device="mps").max_sequence_length, 512)
        self.assertEqual(
            EmbeddingRuntimeConfig(device="mps", max_sequence_length=1024).max_sequence_length,
            1024,
        )
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

    def test_active_mps_plan_fails_closed_before_encoding_under_severe_pressure(self):
        server = EmbeddingServer("test/embed-0.6B")
        server.plan = RuntimePlan(
            usable=True,
            preferred_backend="mps",
            backend="mps",
            device="mps",
            dtype="bfloat16",
            batch_size=1,
            cpu_threads=1,
            model_bytes=1_200_000_000,
            system_reserve_bytes=GIB,
            accelerator_reserve_bytes=512 * 1024 * 1024,
            reason=None,
        )
        server.model = Mock()
        server._current_memory = lambda: MemorySnapshot(
            system_total_bytes=24 * GIB,
            system_available_bytes=GIB,
            accelerator_total_bytes=24 * GIB,
            accelerator_free_bytes=GIB,
        )

        with self.assertRaisesRegex(RuntimeError, "memory pressure crossed the safety reserve"):
            server.encode(["chunk"])
        server.model.encode.assert_not_called()


if __name__ == "__main__":
    unittest.main()
