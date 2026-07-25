import sys
import types
import unittest


class FakeAccelerator:
    def is_available(self):
        return False

    def empty_cache(self):
        pass


fake_torch = types.ModuleType("torch")
fake_torch.__version__ = "test"
fake_torch.backends = types.SimpleNamespace(mps=FakeAccelerator())
fake_torch.cuda = FakeAccelerator()
fake_torch.mps = FakeAccelerator()
fake_torch.version = types.SimpleNamespace(cuda=None, hip=None)
fake_torch.float16 = "float16"
fake_torch.float32 = "float32"
fake_torch.get_num_threads = lambda: 1
fake_torch.set_num_threads = lambda _threads: None
sys.modules["torch"] = fake_torch

fake_sentence_transformers = types.ModuleType("sentence_transformers")
fake_sentence_transformers.SentenceTransformer = object
sys.modules["sentence_transformers"] = fake_sentence_transformers

from embedding_server import EmbeddingServer
from resource_manager import GIB, MemorySnapshot, RuntimePlan


class FakeEmbeddings:
    def __init__(self, rows):
        self.rows = rows

    def tolist(self):
        return self.rows


class BackingOffModel:
    device = "cpu"

    def __init__(self):
        self.batch_sizes = []

    def encode(self, texts, *, batch_size, **_options):
        self.batch_sizes.append(batch_size)
        if batch_size > 2:
            raise RuntimeError("out of memory")
        return FakeEmbeddings([[float(len(text))] for text in texts])


class EmbeddingServerTest(unittest.TestCase):
    def make_server(self):
        server = EmbeddingServer("test/embed-0.6B")
        server.model = BackingOffModel()
        server.plan = RuntimePlan(
            usable=True,
            preferred_backend="cpu",
            backend="cpu",
            device="cpu",
            dtype="float32",
            batch_size=8,
            cpu_threads=4,
            model_bytes=2_400_000_000,
            system_reserve_bytes=GIB,
            accelerator_reserve_bytes=0,
            reason=None,
        )
        server._refresh_active_plan = lambda: None
        return server

    def test_halves_micro_batch_after_oom_and_completes_the_request(self):
        server = self.make_server()

        result = server.encode([f"chunk {index}" for index in range(8)])

        self.assertEqual(server.model.batch_sizes, [8, 4, 2, 2, 2, 2])
        self.assertEqual(len(result), 8)
        self.assertEqual(server.oom_backoffs, 2)
        self.assertEqual(server.oom_batch_ceiling, 2)

    def test_releases_oom_ceiling_after_sustained_success(self):
        server = self.make_server()
        server.oom_batch_ceiling = 2

        for _ in range(8):
            server.encode(["one", "two"])

        self.assertIsNone(server.oom_batch_ceiling)
        self.assertEqual(server.successful_requests_since_oom, 0)

    def test_health_reports_plan_memory_and_backoff_state(self):
        server = self.make_server()
        server.oom_backoffs = 3
        server._current_memory = lambda: MemorySnapshot(
            system_total_bytes=32 * GIB,
            system_available_bytes=20 * GIB,
        )

        health = server.health()

        self.assertEqual(health["resource_plan"]["cpu_threads"], 4)
        self.assertEqual(health["memory"]["system_available_bytes"], 20 * GIB)
        self.assertEqual(health["runtime"]["oom_backoffs"], 3)


if __name__ == "__main__":
    unittest.main()
