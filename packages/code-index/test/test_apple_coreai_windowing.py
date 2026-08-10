"""Tests for bounded Apple Core AI long-sequence pooling."""

import os
import sys
import unittest

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from apple_coreai_windowing import iter_token_windows, pool_window_vectors


class AppleCoreAIWindowingTest(unittest.TestCase):
    def test_splits_all_tokens_into_bounded_windows(self):
        tokens = np.arange(130, dtype=np.int64)

        windows = list(iter_token_windows(tokens, 64))

        self.assertEqual([len(window) for window in windows], [64, 64, 2])
        np.testing.assert_array_equal(np.concatenate(windows), tokens)

    def test_pools_by_covered_token_count_and_normalizes(self):
        pooled = pool_window_vectors(
            [np.array([1.0, 0.0]), np.array([0.0, 1.0])],
            [3, 1],
            normalize=True,
        )

        np.testing.assert_allclose(pooled, np.array([0.9486833, 0.31622776]), rtol=1e-6)
        self.assertAlmostEqual(float(np.linalg.norm(pooled)), 1.0, places=6)

    def test_rejects_empty_or_invalid_windows(self):
        with self.assertRaisesRegex(ValueError, "window_size must be positive"):
            list(iter_token_windows(np.arange(1), 0))
        with self.assertRaisesRegex(ValueError, "non-empty and aligned"):
            pool_window_vectors([], [], normalize=True)


if __name__ == "__main__":
    unittest.main()
