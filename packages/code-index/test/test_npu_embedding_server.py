"""Tests for NPU health metadata and Vitis AI provider configuration."""

import unittest

from test_embedding_server import EmbeddingServerTest


class NpuEmbeddingServerTest(unittest.TestCase):
    def test_health_reports_the_actual_execution_provider(self):
        server = EmbeddingServerTest().make_server()
        server.model.provider = "VitisAIExecutionProvider"

        health = server.health()

        self.assertEqual(health["executionProvider"], "VitisAIExecutionProvider")

    def test_vitisai_options_do_not_require_a_legacy_config_file(self):
        from embedding_server import _vitisai_provider_options

        self.assertEqual(
            _vitisai_provider_options(
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


if __name__ == "__main__":
    unittest.main()
