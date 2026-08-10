"""Bound MPSGraph variants by keeping SentenceTransformer input shapes stable."""

MPS_DEFAULT_SEQUENCE_LENGTH = 512


def sentence_transformer_encode_options(
    backend: str, sequence_length: int
) -> dict[str, object]:
    if backend != "mps":
        return {}
    return {
        "processing_kwargs": {
            "text": {
                "padding": "max_length",
                "max_length": sequence_length,
                "truncation": "longest_first",
            }
        }
    }
