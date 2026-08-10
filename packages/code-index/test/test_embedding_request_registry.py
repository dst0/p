import threading
import time
import unittest

from embedding_request_registry import EmbeddingRequestRegistry


class EmbeddingRequestRegistryTest(unittest.TestCase):
    def test_cancel_waits_for_request_completion(self):
        registry = EmbeddingRequestRegistry()
        cancelled = registry.register("request-1")
        result: list[bool] = []
        waiter = threading.Thread(
            target=lambda: result.append(registry.cancel_and_wait("request-1", 1.0))
        )

        waiter.start()
        self.assertTrue(cancelled.wait(0.5))
        time.sleep(0.01)
        self.assertEqual(result, [])
        registry.complete("request-1")
        waiter.join(0.5)

        self.assertEqual(result, [True])
        self.assertEqual(registry.active_count(), 0)

    def test_cancel_before_register_prevents_late_execution(self):
        registry = EmbeddingRequestRegistry()

        self.assertTrue(registry.cancel_and_wait("request-2", 0.1))
        cancelled = registry.register("request-2")

        self.assertTrue(cancelled.is_set())
        registry.complete("request-2")


if __name__ == "__main__":
    unittest.main()
