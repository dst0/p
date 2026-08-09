import unittest
from unittest.mock import Mock

from resource_manager import GIB, RuntimePlan
from test_embedding_server import EmbeddingServer, fake_torch


class MpsMemoryPolicyTest(unittest.TestCase):
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

        with self.assertRaisesRegex(RuntimeError, "batch size 1"):
            server.encode(["chunk"])

        self.assertEqual(server.plan.backend, "mps")
        self.assertIn("refusing CPU fallback after accelerator OOM", server.warnings[0])

    def test_configures_stable_mps_memory_fraction(self):
        server = EmbeddingServer("test/embed-0.6B")
        plan = RuntimePlan(
            usable=True,
            preferred_backend="mps",
            backend="mps",
            device="mps",
            dtype="float32",
            batch_size=4,
            cpu_threads=4,
            model_bytes=2_400_000_000,
            system_reserve_bytes=GIB,
            accelerator_reserve_bytes=GIB,
            reason=None,
        )

        server._configure_mps_limit(plan)

        self.assertEqual(fake_torch.mps.memory_fraction, 0.95)


if __name__ == "__main__":
    unittest.main()

