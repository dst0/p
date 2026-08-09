#!/usr/bin/env python3
"""Build and validate the managed Phoenix Qwen encoder artifact manifest."""

import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import tempfile
from types import SimpleNamespace

import numpy as np
from huggingface_hub import snapshot_download
from sentence_transformers import SentenceTransformer

from amd_phoenix_qwen_encoder import AmdPhoenixQwenEncoder

MODEL_NAME = "Qwen/Qwen3-Embedding-0.6B"
SEQUENCE_LENGTHS = [512, 1024, 2048]
VALIDATION_TEXTS = [
    "Phoenix NPU full encoder validation",
    "Semantic indexing must execute every Qwen transformer layer on the NPU.",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact-directory", required=True)
    parser.add_argument("--cache-directory", required=True)
    parser.add_argument("--source-directory", required=True)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = build_and_validate(args)
    print(json.dumps(result, sort_keys=True) if args.json else "Phoenix Qwen artifact validated")


def build_and_validate(args):
    model_path = snapshot_download(MODEL_NAME)
    weight_path = os.path.join(model_path, "model.safetensors")
    model_revision = os.path.basename(model_path)
    weight_stat = os.stat(weight_path)
    artifact_root = os.path.join(
        args.artifact_directory, MODEL_NAME.replace("/", "_")
    )
    manifest_path = os.path.join(artifact_root, "manifest.json")
    existing = _read_json(manifest_path)
    weight_hash = _reusable_weight_hash(existing, weight_path, weight_stat)
    if weight_hash is None:
        weight_hash = _sha256_file(weight_path)
    toolchain = _toolchain_identity()
    identity = {
        "batchSizes": [1, 2],
        "deviceGeneration": "npu1",
        "implementationHash": _implementation_hash(),
        "mlirAie": toolchain["mlirAie"],
        "modelRevision": model_revision,
        "peano": toolchain["peano"],
        "precision": "bf16",
        "sequenceLengths": SEQUENCE_LENGTHS,
        "weightHash": weight_hash,
        "xrt": toolchain["xrt"],
    }
    artifact_key = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    if existing.get("artifactKey") == artifact_key and existing.get("modelValidated"):
        return {"artifactKey": artifact_key, "reused": True, "validation": existing["validation"]}
    os.makedirs(artifact_root, mode=0o700, exist_ok=True)
    manifest = {
        **identity,
        "artifactKey": artifact_key,
        "encoderLayers": 28,
        "model": MODEL_NAME,
        "modelPath": model_path,
        "modelValidated": False,
        "runtimeModule": "builtin:amd_phoenix_qwen_encoder",
        "toolchain": toolchain,
        "weightMtimeNs": weight_stat.st_mtime_ns,
        "weightSize": weight_stat.st_size,
    }
    _write_json_atomic(manifest_path, manifest)
    runtime = SimpleNamespace(
        amd_iron_source_directory=args.source_directory,
        amd_iron_cache_directory=os.path.join(args.cache_directory, artifact_key),
    )
    spec = SimpleNamespace(model_name=MODEL_NAME, dimensions=1024)
    encoder = AmdPhoenixQwenEncoder(spec, manifest, runtime)
    try:
        npu_batch = np.asarray(
            encoder.encode(VALIDATION_TEXTS, normalize=True, batch_size=2),
            dtype=np.float32,
        )
        npu_repeat = np.asarray(
            encoder.encode([VALIDATION_TEXTS[0]], normalize=True, batch_size=1)[0],
            dtype=np.float32,
        )
        proof = encoder.dispatch_proof()
    finally:
        encoder.close()
    cpu_model = SentenceTransformer(model_path, device="cpu")
    cpu_model.max_seq_length = SEQUENCE_LENGTHS[-1]
    cpu_batch = np.asarray(
        cpu_model.encode(VALIDATION_TEXTS, normalize_embeddings=True),
        dtype=np.float32,
    )
    cosine = np.sum(npu_batch * cpu_batch, axis=1)
    repeat_error = float(np.max(np.abs(npu_batch[0] - npu_repeat)))
    batch_norm_error = float(np.max(np.abs(np.linalg.norm(npu_batch, axis=1) - 1.0)))
    if float(np.min(cosine)) < 0.90:
        raise RuntimeError(f"Phoenix Qwen golden cosine is too low: {cosine.tolist()}")
    if repeat_error > 0.01:
        raise RuntimeError(f"Phoenix Qwen repeatability error is too high: {repeat_error}")
    required = {
        "attention-scale",
        "attention-softmax",
        "matmul",
        "residual-add",
        "rms-norm",
        "rope",
        "silu",
        "swiglu",
    }
    if not required.issubset(proof["operations"]):
        raise RuntimeError(f"Phoenix dispatch proof is incomplete: {proof}")
    manifest.update(
        {
            "dispatchProof": proof,
            "modelValidated": True,
            "validation": {
                "batchNormMaximumError": batch_norm_error,
                "cpuGoldenCosine": cosine.tolist(),
                "repeatMaximumError": repeat_error,
            },
        }
    )
    _write_json_atomic(manifest_path, manifest)
    return {"artifactKey": artifact_key, "reused": False, "validation": manifest["validation"]}


def _toolchain_identity():
    examine = subprocess.run(
        ["xrt-smi", "examine"], check=True, capture_output=True, text=True
    ).stdout
    version_line = next((line.strip() for line in examine.splitlines() if "Version" in line), "unknown")
    return {
        "mlirAie": importlib.metadata.version("mlir_aie"),
        "peano": importlib.metadata.version("llvm-aie"),
        "xrt": version_line,
    }


def _reusable_weight_hash(existing, weight_path, weight_stat):
    if (
        existing.get("modelPath") == os.path.dirname(weight_path)
        and existing.get("weightSize") == weight_stat.st_size
        and existing.get("weightMtimeNs") == weight_stat.st_mtime_ns
    ):
        return existing.get("weightHash")
    return None


def _sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        while chunk := source.read(4 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _implementation_hash():
    root = os.path.dirname(os.path.abspath(__file__))
    digest = hashlib.sha256()
    for name in (
        "amd_phoenix_iron_designs.py",
        "amd_phoenix_iron_ops.py",
        "amd_phoenix_qwen_encoder.py",
        "amd_phoenix_rms_norm.cc",
        "amd_phoenix_rope.cc",
        "amd_phoenix_softmax.cc",
    ):
        digest.update(name.encode())
        with open(os.path.join(root, name), "rb") as source:
            digest.update(source.read())
    return digest.hexdigest()


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as source:
            return json.load(source)
    except (OSError, json.JSONDecodeError):
        return {}


def _write_json_atomic(path, value):
    directory = os.path.dirname(path)
    descriptor, temporary = tempfile.mkstemp(prefix="manifest-", suffix=".json", dir=directory)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(value, output, indent=2, sort_keys=True)
            output.write("\n")
        os.chmod(temporary, 0o600)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    main()
