#!/usr/bin/env python3
"""Build a static-shape Qwen embedding asset for the Apple Neural Engine."""

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path

import numpy as np
import torch
from coreai_torch import TorchConverter
from huggingface_hub import snapshot_download
from safetensors.torch import load_file
from transformers import AutoConfig, AutoTokenizer

from apple_coreai_artifact_locator import (
    CANONICAL_ARTIFACT_VERSION,
    CANONICAL_MODEL_ID,
    EXPECTED_BATCH_SIZE,
    EXPECTED_SEQUENCE_LENGTH,
    validate_generation_name,
)
from apple_coreai_model import AppleCoreAIEmbeddingModel
from coreai_models.export.mlir_ops import (
    register_custom_torch_lowering,
    remove_functionalization,
)
from coreai_models.models.ios.qwen3 import Qwen3ForCausalLMForiOS


MODEL_ID = CANONICAL_MODEL_ID
ARTIFACT_VERSION = CANONICAL_ARTIFACT_VERSION
BATCH_SIZE = EXPECTED_BATCH_SIZE
SEQUENCE_LENGTH = EXPECTED_SEQUENCE_LENGTH
TRACE_BATCH_SIZE = 1
TRACE_SEQUENCE_LENGTH = 64


def load_model() -> tuple[AppleCoreAIEmbeddingModel, np.ndarray, torch.Tensor, torch.Tensor]:
    model_dir = snapshot_download(
        MODEL_ID,
        allow_patterns=["*.safetensors", "config.json"],
    )
    config = AutoConfig.from_pretrained(model_dir)
    config.max_position_embeddings = SEQUENCE_LENGTH
    parent = Qwen3ForCausalLMForiOS(
        config,
        model_device="meta",
        disable_embedding_quantization=True,
    )
    parent.to(dtype=torch.float16)
    raw_state = load_file(str(Path(model_dir) / "model.safetensors"))
    state = {f"model.{key}": value.to(torch.float16) for key, value in raw_state.items()}
    del raw_state
    parent._mutate_state_dict(state)
    parent.load_state_dict(state, assign=True, strict=False)
    missing = [
        name for name, parameter in parent.extend.model.named_parameters() if parameter.is_meta
    ]
    if missing:
        raise RuntimeError(f"Qwen parameters were not loaded: {missing}")
    embeddings = parent.load_embeddings.embedding_table.detach().numpy()
    rope_cos = parent.extend.rope.cos_cached[:TRACE_SEQUENCE_LENGTH].unsqueeze(0)
    rope_sin = parent.extend.rope.sin_cached[:TRACE_SEQUENCE_LENGTH].unsqueeze(0)
    return AppleCoreAIEmbeddingModel(parent.extend.model).eval(), embeddings, rope_cos, rope_sin


def make_causal_mask() -> torch.Tensor:
    keys = torch.arange(TRACE_SEQUENCE_LENGTH).unsqueeze(1)
    queries = torch.arange(TRACE_SEQUENCE_LENGTH).unsqueeze(0)
    mask = torch.zeros((TRACE_SEQUENCE_LENGTH, TRACE_SEQUENCE_LENGTH), dtype=torch.float16)
    mask.masked_fill_(keys > queries, -40000.0)
    return mask.unsqueeze(0).unsqueeze(2)


def export_asset(destination: Path) -> None:
    model, embedding_table, rope_cos, rope_sin = load_model()
    token_embeddings = torch.from_numpy(
        embedding_table[: TRACE_BATCH_SIZE * TRACE_SEQUENCE_LENGTH]
    ).reshape(TRACE_BATCH_SIZE, TRACE_SEQUENCE_LENGTH, 1, -1)
    inputs = {
        "token_embeddings": token_embeddings,
        "rope_cos": rope_cos,
        "rope_sin": rope_sin,
        "causal_mask": make_causal_mask(),
    }
    decompositions = torch.export.default_decompositions()
    decompositions.pop(torch.ops.aten.silu.default)
    decompositions.pop(torch.ops.aten.silu.out)
    sequence = torch.export.Dim("sequence_length", min=1, max=SEQUENCE_LENGTH)
    with torch.no_grad():
        exported = torch.export.export(
            model,
            args=(),
            kwargs=inputs,
            dynamic_shapes={
                "token_embeddings": {1: sequence},
                "rope_cos": {1: sequence},
                "rope_sin": {1: sequence},
                "causal_mask": {1: sequence, 3: sequence},
            },
        ).run_decompositions(decompositions)
    remove_functionalization(exported)
    converter = TorchConverter()
    register_custom_torch_lowering(converter)
    converter.add_exported_program(
        exported,
        input_names=tuple(inputs),
        output_names=("hidden_states",),
        entrypoint_name="embed",
    )
    program = converter.to_coreai()
    program.set_static_shape_config(
        "embed",
        {
            f'"{SEQUENCE_LENGTH}"': {
                "token_embeddings": (BATCH_SIZE, SEQUENCE_LENGTH, 1, 1024),
                "rope_cos": (1, SEQUENCE_LENGTH, 128),
                "rope_sin": (1, SEQUENCE_LENGTH, 128),
                "causal_mask": (1, SEQUENCE_LENGTH, 1, SEQUENCE_LENGTH),
            }
        },
    )
    program.optimize()
    program.save_asset(destination / "model.aimodel")
    np.save(destination / "embedding-table.npy", embedding_table)
    AutoTokenizer.from_pretrained(MODEL_ID).save_pretrained(destination / "tokenizer")
    (destination / "artifact.json").write_text(
        json.dumps(
            {
                "artifactVersion": ARTIFACT_VERSION,
                "batchSize": BATCH_SIZE,
                "model": MODEL_ID,
                "sequenceLength": SEQUENCE_LENGTH,
            },
            indent=2,
        )
        + "\n"
    )


validate_generation = validate_generation_name


def build_candidate(root: Path, generation: str) -> Path:
    validate_generation(generation)
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    destination = root / generation
    if os.path.lexists(destination):
        raise FileExistsError(
            f"Candidate generation destination already exists: {destination}"
        )

    temporary = Path(tempfile.mkdtemp(prefix=f".building-{generation}-", dir=root))
    try:
        export_asset(temporary)
        if os.path.lexists(destination):
            raise FileExistsError(
                f"Candidate generation destination already exists: {destination}"
            )
        os.replace(temporary, destination)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)
    return destination


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--generation", type=str, required=True)
    args = parser.parse_args()
    dest = build_candidate(args.output_root, args.generation)
    print(
        json.dumps(
            {
                "artifactDirectory": str(dest),
                "generation": args.generation,
            }
        )
    )


if __name__ == "__main__":
    main()
