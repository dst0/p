import unittest

from embedding_performance import EmbeddingPerformanceTracker


class EmbeddingPerformanceTrackerTest(unittest.TestCase):
    def test_reports_real_multi_vector_throughput(self):
        tracker = EmbeddingPerformanceTracker()

        tracker.record("mps", 8, 0.004)
        tracker.record("mps", 8, 0.006)

        self.assertEqual(
            tracker.snapshot(),
            {
                "backend": "mps",
                "vectors": 16,
                "seconds": 0.01,
                "vectorsPerSecond": 1600.0,
                "lastVectorsPerSecond": 1333.33,
            },
        )

    def test_ignores_single_query_and_resets_after_backend_change(self):
        tracker = EmbeddingPerformanceTracker()
        tracker.record("mps", 1, 0.001)
        tracker.record("mps", 8, 0.008)

        tracker.record("cpu", 4, 0.008)

        self.assertEqual(tracker.snapshot()["backend"], "cpu")
        self.assertEqual(tracker.snapshot()["vectors"], 4)
        self.assertEqual(tracker.snapshot()["vectorsPerSecond"], 500.0)


if __name__ == "__main__":
    unittest.main()

