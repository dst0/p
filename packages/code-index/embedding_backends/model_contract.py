"""Model contract utilities: hashing, compatibility groups, canonical pooling rules."""

import hashlib
import json


def compute_tokenizer_hash(tokenizer_or_name: str) -> str:
    """Compute deterministic SHA-256 fingerprint for tokenizer identifier/config."""
    content = str(tokenizer_or_name).strip().encode("utf-8")
    return hashlib.sha256(content).hexdigest()[:16]


def compute_compatibility_group(
    model_name: str,
    dimensions: int,
    pooling: str,
    normalization: str,
) -> str:
    """
    Generate canonical compatibility group string.

    Backends sharing the same compatibility group produce mathematically equivalent
    embeddings and do NOT require re-indexing Qdrant vectors.
    """
    slug = model_name.lower().replace("/", "_").replace("-", "_")
    return f"{slug}-{dimensions}-{pooling}-{normalization}"


def compute_model_artifact_hash(artifact_dir: str) -> str:
    """Hash files in an artifact directory to detect model asset drift."""
    hasher = hashlib.sha256()
    try:
        import os
        for root, _, files in sorted(os.walk(artifact_dir)):
            for filename in sorted(files):
                filepath = os.path.join(root, filename)
                hasher.update(filename.encode("utf-8"))
                try:
                    with open(filepath, "rb") as f:
                        while chunk := f.read(65536):
                            hasher.update(chunk)
                except OSError:
                    pass
    except Exception:
        hasher.update(artifact_dir.encode("utf-8"))
    return hasher.hexdigest()[:16]
