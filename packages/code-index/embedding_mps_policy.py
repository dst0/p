"""Bound Apple accelerator input shapes while preserving other backend context."""

import sys

DEFAULT_SEQUENCE_LENGTH = 2048
MPS_DEFAULT_SEQUENCE_LENGTH = 512


def default_sequence_length(device: str, platform: str | None = None) -> int:
    active_platform = platform or sys.platform
    apple_accelerator = device in {"mps", "apple-mps", "apple-ane"}
    automatic_apple_accelerator = (
        active_platform == "darwin" and device in {"auto", "npu"}
    )
    return (
        MPS_DEFAULT_SEQUENCE_LENGTH
        if apple_accelerator or automatic_apple_accelerator
        else DEFAULT_SEQUENCE_LENGTH
    )


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
