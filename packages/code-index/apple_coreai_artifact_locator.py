"""Artifact resolution and metadata verification for Apple Neural Engine Core AI models."""

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

CANONICAL_MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"
CANONICAL_ARTIFACT_VERSION = "qwen3-embedding-0.6b-ane-b1-s64-v1"
EXPECTED_BATCH_SIZE = 1
EXPECTED_SEQUENCE_LENGTH = 64


def validate_generation_name(generation: str) -> None:
    if not isinstance(generation, str) or not generation:
        raise ValueError("Generation name must be a non-empty string")
    if "/" in generation or "\\" in generation or ".." in generation:
        raise ValueError(
            f"Generation name cannot contain path separators or traversal: {generation}"
        )
    prefix = f"{CANONICAL_ARTIFACT_VERSION}-"
    if not generation.startswith(prefix):
        raise ValueError(
            f"Generation name must start with prefix '{prefix}', got: {generation}"
        )
    uuid_part = generation[len(prefix) :]
    if not re.match(
        r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
        uuid_part,
        re.IGNORECASE,
    ):
        raise ValueError(f"Generation name must end with a valid UUID: {uuid_part}")
    try:
        uuid.UUID(uuid_part)
    except Exception as err:
        raise ValueError(f"Invalid UUID in generation name: {uuid_part}") from err


def validate_artifact_metadata(metadata: dict[str, Any], metadata_path: Path) -> tuple[int, int]:
    if not isinstance(metadata, dict):
        raise ValueError(f"Invalid artifact metadata in {metadata_path}: root must be an object")

    artifact_version = metadata.get("artifactVersion")
    if artifact_version != CANONICAL_ARTIFACT_VERSION:
        raise RuntimeError(
            f"Artifact version mismatch: expected '{CANONICAL_ARTIFACT_VERSION}', got '{artifact_version}'"
        )

    model = metadata.get("model")
    if model != CANONICAL_MODEL_ID:
        raise RuntimeError(
            f"Artifact model mismatch: expected '{CANONICAL_MODEL_ID}', got '{model}'"
        )

    batch_size = metadata.get("batchSize")
    if not isinstance(batch_size, int) or isinstance(batch_size, bool) or batch_size != EXPECTED_BATCH_SIZE:
        raise RuntimeError(
            f"Core AI fast-path asset must have integer batchSize {EXPECTED_BATCH_SIZE}, got {batch_size!r}"
        )

    sequence_length = metadata.get("sequenceLength")
    if not isinstance(sequence_length, int) or isinstance(sequence_length, bool) or sequence_length != EXPECTED_SEQUENCE_LENGTH:
        raise RuntimeError(
            f"Core AI fast-path asset must have integer sequenceLength {EXPECTED_SEQUENCE_LENGTH}, got {sequence_length!r}"
        )

    return batch_size, sequence_length


def _validate_artifact_dir(directory: Path) -> tuple[Path, int, int]:
    if directory.is_symlink() or os.path.islink(directory):
        raise ValueError(f"Artifact directory cannot be a symlink: {directory}")
    if not directory.is_dir():
        raise RuntimeError(f"Artifact directory does not exist: {directory}")

    metadata_file = directory / "artifact.json"
    if metadata_file.is_symlink() or os.path.islink(metadata_file):
        raise ValueError(f"Artifact metadata file cannot be a symlink: {metadata_file}")
    if not metadata_file.is_file():
        raise RuntimeError(f"Artifact metadata file missing: {metadata_file}")

    try:
        metadata = json.loads(metadata_file.read_text(encoding="utf-8"))
    except Exception as err:
        raise RuntimeError(f"Failed to parse artifact metadata from {metadata_file}: {err}") from err

    batch_size, seq_len = validate_artifact_metadata(metadata, metadata_file)
    return directory, batch_size, seq_len


def resolve_coreai_artifact(
    artifact_root: Path | None = None,
    artifact_directory: Path | None = None,
) -> tuple[Path, int, int]:
    if (artifact_root is None and artifact_directory is None) or (
        artifact_root is not None and artifact_directory is not None
    ):
        raise ValueError("Exactly one of artifact_root or artifact_directory must be provided")

    if artifact_directory is not None:
        candidate_dir = Path(artifact_directory)
        return _validate_artifact_dir(candidate_dir)

    assert artifact_root is not None
    root_path = Path(artifact_root).resolve()
    current_path = root_path / "current.json"

    if current_path.is_symlink() or os.path.islink(current_path):
        raise ValueError(f"Symlink current.json pointer rejected: {current_path}")
    if not current_path.is_file():
        raise RuntimeError(f"Current artifact pointer missing: {current_path}")

    try:
        marker = json.loads(current_path.read_text(encoding="utf-8"))
    except Exception as err:
        raise ValueError(f"Invalid current.json pointer JSON: {err}") from err

    if not isinstance(marker, dict):
        raise ValueError("Invalid current.json pointer: root must be an object")

    pointer_version = marker.get("artifactVersion")
    if pointer_version != CANONICAL_ARTIFACT_VERSION:
        raise ValueError(
            f"Pointer artifactVersion mismatch: expected '{CANONICAL_ARTIFACT_VERSION}', got '{pointer_version}'"
        )

    if "artifactDirectory" in marker:
        entry = marker["artifactDirectory"]
        if not isinstance(entry, str) or not entry:
            raise ValueError(f"Invalid artifactDirectory in current.json: {entry!r}")
        if "/" in entry or "\\" in entry or ".." in entry or Path(entry).is_absolute():
            raise ValueError(f"Unsafe artifact directory in current.json: {entry}")
        target_path = root_path / entry
        if target_path.is_symlink() or os.path.islink(target_path):
            raise ValueError(f"Symlink artifact directory escape rejected: {entry}")
        resolved_candidate = target_path.resolve()
        if resolved_candidate.parent != root_path:
            raise ValueError(f"Artifact directory is not a direct child of root: {entry}")
        return _validate_artifact_dir(resolved_candidate)

    # Legacy pointer containing canonical artifactVersion only
    entry = pointer_version
    target_path = root_path / entry
    if target_path.is_symlink() or os.path.islink(target_path):
        raise ValueError(f"Symlink artifact directory escape rejected: {entry}")
    resolved_candidate = target_path.resolve()
    if resolved_candidate.parent != root_path:
        raise ValueError(f"Artifact directory is not a direct child of root: {entry}")
    return _validate_artifact_dir(resolved_candidate)
