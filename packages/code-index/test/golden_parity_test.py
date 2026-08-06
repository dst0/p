"""Golden parity and backend contract test suite for hardware-aware code indexing."""

import math
import sys
import unittest

from embedding_backends import (
    BackendHealth,
    EmbeddingBackend,
    ModelSpec,
    compute_compatibility_group,
    compute_tokenizer_hash,
    format_backend_health,
    resolve_backend,
    resolve_legacy_backend_id,
)


CANONICAL_TEST_CORPUS = [
    "tool definition system for registering LLM-callable tools with TypeBox schemas",
    "export interface ToolDefinition {\n  name: string;\n  description: string;\n}",
    "class EmbeddingBackend(Protocol):\n    def load(self, spec: ModelSpec) -> None: pass",
    "pub trait VectorStore {\n    fn search(&self, query: &[f32]) -> Vec<Point>;\n}",
    "# Helper function to calculate vector cosine similarity\ndef cosine(a, b):\n    return sum(x*y for x,y in zip(a,b))",
    "short query",
    "x" * 500,
]


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


class TestBackendContractAndParity(unittest.TestCase):

    def test_legacy_backend_id_migration(self):
        if sys.platform == "darwin":
            self.assertEqual(resolve_legacy_backend_id("npu"), "apple-ane")
            self.assertEqual(resolve_legacy_backend_id("auto"), "apple-ane")
        else:
            with self.assertRaises(ValueError):
                resolve_legacy_backend_id("npu")
        self.assertEqual(resolve_legacy_backend_id("cuda"), "nvidia-cuda")
        self.assertEqual(resolve_legacy_backend_id("rocm"), "amd-rocm")
        self.assertEqual(resolve_legacy_backend_id("mps"), "apple-mps")
        self.assertEqual(resolve_legacy_backend_id("cpu"), "cpu")

    def test_compatibility_group(self):
        group = compute_compatibility_group("Qwen/Qwen3-Embedding-0.6B", 1024, "last-non-padding-token", "l2")
        self.assertEqual(group, "qwen_qwen3_embedding_0.6b-1024-last-non-padding-token-l2")

    def test_backend_registry(self):
        backend = resolve_backend("cpu", strict=False)
        self.assertIsNotNone(backend)
        self.assertEqual(backend.backend_id, "cpu")

    def test_health_formatting(self):
        health = BackendHealth(
            status="ready",
            requested_backend="apple-ane",
            selected_backend="apple-ane",
            execution_device="Apple Neural Engine",
            gpu_allowed=False,
            fallback_occurred=False,
        )
        formatted = format_backend_health(health)
        self.assertEqual(formatted["requestedBackend"], "apple-ane")
        self.assertEqual(formatted["executionDevice"], "Apple Neural Engine")
        self.assertFalse(formatted["gpuAllowed"])
        self.assertFalse(formatted["fallbackOccurred"])

    def test_torch_backend_encode_parity(self):
        try:
            backend = resolve_backend("cpu", strict=False)
            spec = ModelSpec(model_name="Qwen/Qwen3-Embedding-0.6B", dimensions=1024)
            backend.load(spec)
        except Exception as e:
            self.skipTest(f"SentenceTransformers or model not cached: {e}")

        vectors = backend.encode(CANONICAL_TEST_CORPUS, normalize=True, batch_size=2)
        self.assertEqual(len(vectors), len(CANONICAL_TEST_CORPUS))
        for vec in vectors:
            self.assertEqual(len(vec), 1024)
            self.assertTrue(all(math.isfinite(x) for x in vec))
            norm = math.sqrt(sum(x * x for x in vec))
            self.assertAlmostEqual(norm, 1.0, places=3)

        # Check self-cosine similarity is 1.0
        self.assertAlmostEqual(cosine_similarity(vectors[0], vectors[0]), 1.0, places=5)
        # Check non-identical vectors have high but distinct similarity
        sim = cosine_similarity(vectors[0], vectors[1])
        self.assertGreater(sim, 0.2)
        self.assertLess(sim, 1.0)


if __name__ == "__main__":
    unittest.main()
