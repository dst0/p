"""Tests for ONNX embedding pooling and raw-session execution."""

import os
import sys
import unittest
from unittest.mock import Mock

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from embedding_backends.onnx_embedding_wrapper import ONNXEmbeddingWrapper, last_token_pool_np


class OnnxEmbeddingWrapperTest(unittest.TestCase):
    def test_past_key_values_use_direct_session_run(self):
        mock_session = Mock()
        mock_input = Mock()
        mock_input.name = "past_key_values.0.key"
        mock_session.get_inputs.return_value = [mock_input]
        mock_output = Mock()
        mock_output.name = "last_hidden_state"
        mock_session.get_outputs.return_value = [mock_output]
        mock_session.run.return_value = [np.arange(8, dtype=np.float32).reshape(1, 4, 2)]
        mock_ort_model = Mock(model=mock_session)
        mock_tokenizer = Mock(
            return_value={
                "input_ids": np.ones((1, 4), dtype=np.int64),
                "attention_mask": np.ones((1, 4), dtype=np.int64),
                "past_key_values.0.key": np.zeros((1, 8, 0, 64), dtype=np.float32),
            }
        )

        wrapper = ONNXEmbeddingWrapper(mock_ort_model, mock_tokenizer, "test-device")
        result = wrapper.encode(["sample text"], normalize_embeddings=False)

        self.assertEqual(len(result), 1)
        np.testing.assert_array_equal(result[0], np.array([6.0, 7.0], dtype=np.float32))
        mock_session.run.assert_called_once()

    def test_last_token_pooling_matches_qwen_attention_mask_contract(self):
        token_embeddings = np.array(
            [
                [[1.0, 10.0], [2.0, 20.0], [3.0, 30.0], [4.0, 40.0]],
                [[5.0, 50.0], [6.0, 60.0], [7.0, 70.0], [8.0, 80.0]],
            ],
            dtype=np.float32,
        )
        right_mask = np.array([[1, 1, 1, 0], [1, 1, 0, 0]], dtype=np.int64)
        left_mask = np.array([[0, 1, 1, 1], [0, 0, 1, 1]], dtype=np.int64)

        np.testing.assert_array_equal(
            last_token_pool_np(token_embeddings, right_mask, np),
            np.array([[3.0, 30.0], [6.0, 60.0]], dtype=np.float32),
        )
        np.testing.assert_array_equal(
            last_token_pool_np(token_embeddings, left_mask, np),
            np.array([[4.0, 40.0], [8.0, 80.0]], dtype=np.float32),
        )


if __name__ == "__main__":
    unittest.main()
