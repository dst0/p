"""Bounded long-sequence helpers for the Apple Core AI embedding worker."""

from collections.abc import Iterator

import numpy as np


def iter_token_windows(token_ids: np.ndarray, window_size: int) -> Iterator[np.ndarray]:
    """Yield fixed-capacity token views without retaining another model graph."""
    if window_size <= 0:
        raise ValueError("window_size must be positive")
    for offset in range(0, len(token_ids), window_size):
        yield token_ids[offset : offset + window_size]


def pool_window_vectors(
    vectors: list[np.ndarray], token_counts: list[int], normalize: bool
) -> np.ndarray:
    """Pool window embeddings by covered token count and optionally L2-normalize."""
    if not vectors or len(vectors) != len(token_counts):
        raise ValueError("vectors and token_counts must be non-empty and aligned")
    total_tokens = sum(token_counts)
    if total_tokens <= 0:
        raise ValueError("token_counts must contain at least one token")
    weighted_sum = np.zeros_like(vectors[0], dtype=np.float32)
    for vector, token_count in zip(vectors, token_counts, strict=True):
        weighted_sum += vector.astype(np.float32, copy=False) * token_count
    pooled = weighted_sum / total_tokens
    if normalize:
        pooled /= max(float(np.linalg.norm(pooled)), 1e-9)
    return pooled
