import unittest
from dataclasses import replace
from unittest.mock import Mock

from test_embedding_server import EmbeddingServerTest, FakeEmbeddings


class EmbeddingCancellationTest(unittest.TestCase):
    def test_mps_uses_a_fixed_sequence_shape(self):
        server = EmbeddingServerTest().make_server()
        server.plan = replace(server.plan, preferred_backend="mps", backend="mps", device="mps", batch_size=1)
        server.sequence_length = 512
        server.model = Mock(spec=["encode"])
        server.model.encode.return_value = FakeEmbeddings([[1.0]])

        result = server.encode(["one"])

        self.assertEqual(result, [[1.0]])
        server.model.encode.assert_called_once_with(
            ["one"],
            normalize_embeddings=True,
            batch_size=1,
            show_progress_bar=False,
            processing_kwargs={
                "text": {"padding": "max_length", "max_length": 512, "truncation": "longest_first"}
            },
        )

    def test_preserves_the_apple_backend_encode_contract(self):
        server = EmbeddingServerTest().make_server()
        server.plan = replace(server.plan, backend="apple-ane", batch_size=1)
        server.model = Mock(backend_id="apple-ane")
        server.model.encode.return_value = [[1.0]]

        result = server.encode(["one"], cancellation_check=lambda: False)

        self.assertEqual(result, [[1.0]])
        server.model.encode.assert_called_once_with(
            ["one"], normalize=True, batch_size=1
        )

    def test_stops_before_the_next_npu_micro_batch(self):
        server = EmbeddingServerTest().make_server()
        server.plan = replace(server.plan, backend="amd-phoenix-npu", batch_size=1)
        server.model = Mock(backend_id="amd-phoenix-npu")
        server.model.encode.return_value = [[1.0]]

        with self.assertRaisesRegex(InterruptedError, "cancelled"):
            server.encode(
                ["one", "two"],
                cancellation_check=lambda: server.model.encode.call_count > 0,
            )

        server.model.encode.assert_called_once()


if __name__ == "__main__":
    unittest.main()
