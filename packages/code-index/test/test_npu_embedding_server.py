"""Tests for NPU health metadata and Vitis AI provider configuration."""

import unittest

from embedding_backends.base import BackendHealth
from test_embedding_server import EmbeddingServerTest


class NpuEmbeddingServerTest(unittest.TestCase):
    def test_health_reports_the_actual_execution_provider(self):
        server = EmbeddingServerTest().make_server()
        server.model.provider = "VitisAIExecutionProvider"

        health = server.health()

        self.assertEqual(health["executionProvider"], "VitisAIExecutionProvider")

    def test_vitisai_options_do_not_require_a_legacy_config_file(self):
        from embedding_npu_runtime import vitisai_provider_options

        self.assertEqual(
            vitisai_provider_options(
                "Qwen/Qwen3-Embedding-0.6B",
                cache_dir="/tmp/p-vitis-cache",
                cache_key="qwen-test",
            ),
            {
                "cache_dir": "/tmp/p-vitis-cache",
                "cache_key": "qwen-test",
                "log_level": "error",
            },
        )

    def test_health_includes_backend_dispatch_and_artifact_metadata(self):
        server = EmbeddingServerTest().make_server()
        server.model.health = lambda: BackendHealth(
            status="ready",
            requested_backend="amd-phoenix-npu",
            selected_backend="amd-phoenix-npu",
            execution_device="AMD Phoenix npu1",
            gpu_allowed=True,
            fallback_occurred=False,
            extra={"artifactHash": "artifact-123", "dispatchProof": {"dispatchCount": 98}},
        )

        health = server.health()

        self.assertEqual(health["artifactHash"], "artifact-123")
        self.assertEqual(health["dispatchProof"]["dispatchCount"], 98)


if __name__ == "__main__":
    unittest.main()
