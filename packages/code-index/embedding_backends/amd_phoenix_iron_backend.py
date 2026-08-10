"""MLIR-AIE/IRON backend for Phoenix and Hawk Point npu1 artifacts."""

import json
import os
from typing import Any

from embedding_backends.base import BackendHealth, ModelSpec
from embedding_backends.model_contract import (
    compute_compatibility_group,
    compute_model_artifact_hash,
    compute_tokenizer_hash,
)


class AmdPhoenixIronBackend:
    backend_id = "amd-phoenix-npu"
    execution_device = "AMD Phoenix/Hawk Point npu1 (MLIR-AIE/IRON)"
    gpu_allowed = True

    def __init__(self, runtime_config, strict: bool = True):
        self.runtime_config = runtime_config
        self.strict = strict
        self.spec = ModelSpec()
        self.encoder: Any = None
        self.manifest: dict[str, Any] = {}
        self.artifact_hash = ""

    def load(self, spec: ModelSpec) -> None:
        self.spec = spec
        artifact_root = os.path.join(
            self.runtime_config.amd_iron_artifact_directory,
            spec.model_name.replace("/", "_"),
        )
        manifest_path = os.path.join(artifact_root, "manifest.json")
        if not os.path.isfile(manifest_path):
            raise RuntimeError(
                f"Phoenix Qwen encoder artifact is missing: {manifest_path}"
            )
        with open(manifest_path, encoding="utf-8") as manifest_file:
            manifest = json.load(manifest_file)
        self._validate_manifest(manifest)
        from amd_phoenix_qwen_encoder import create_encoder

        self.encoder = create_encoder(spec, manifest, self.runtime_config)
        probe = self.encoder.dispatch_probe()
        if probe.get("deviceGeneration") != "npu1" or not probe.get(
            "encoderDispatchVerified"
        ):
            raise RuntimeError(f"Phoenix encoder dispatch proof failed: {probe}")
        self.manifest = manifest
        self.artifact_hash = compute_model_artifact_hash(artifact_root)

    def encode(
        self,
        texts: list[str],
        normalize: bool = True,
        batch_size: int = 8,
        cancellation_check=None,
    ) -> list[list[float]]:
        if self.encoder is None:
            raise RuntimeError("Phoenix Qwen encoder artifact is not loaded")
        return self.encoder.encode(
            texts,
            normalize=normalize,
            batch_size=batch_size,
            cancellation_check=cancellation_check,
        )

    def health(self) -> BackendHealth:
        precision = self.manifest.get("precision", "unknown")
        compatibility = compute_compatibility_group(
            self.spec.model_name,
            self.spec.dimensions,
            self.spec.pooling,
            self.spec.normalization,
        )
        if self.artifact_hash:
            compatibility = f"{compatibility}-{precision}-{self.artifact_hash}"
        dispatch_proof = self.encoder.dispatch_proof() if self.encoder else None
        return BackendHealth(
            status="ready" if self.encoder is not None else "loading",
            requested_backend=self.backend_id,
            selected_backend=self.backend_id,
            execution_device=self.execution_device,
            gpu_allowed=True,
            fallback_occurred=False,
            model_name=self.spec.model_name,
            dimensions=self.spec.dimensions,
            tokenizer_hash=compute_tokenizer_hash(self.spec.model_name),
            pooling=self.spec.pooling,
            normalization=self.spec.normalization,
            compatibility_group=compatibility,
            extra={
                "artifactHash": self.artifact_hash or None,
                "deviceGeneration": "npu1",
                "dispatchProof": dispatch_proof,
                "modelValidated": bool(self.encoder),
                "precision": precision,
                "runtimeFamily": "mlir-aie-iron",
                "runtimeVersion": self.runtime_config.amd_npu_runtime_version,
            },
        )

    def close(self) -> None:
        if self.encoder is not None and hasattr(self.encoder, "close"):
            self.encoder.close()
        self.encoder = None

    def _validate_manifest(self, manifest: dict[str, Any]) -> None:
        expected = {
            "deviceGeneration": "npu1",
            "encoderLayers": 28,
            "model": self.spec.model_name,
            "modelValidated": True,
        }
        mismatches = [
            f"{key}={manifest.get(key)!r} (expected {value!r})"
            for key, value in expected.items()
            if manifest.get(key) != value
        ]
        if manifest.get("precision") not in {"bf16", "int8"}:
            mismatches.append(f"precision={manifest.get('precision')!r}")
        if manifest.get("runtimeModule") != "builtin:amd_phoenix_qwen_encoder":
            mismatches.append(f"runtimeModule={manifest.get('runtimeModule')!r}")
        if not os.path.isfile(os.path.join(manifest.get("modelPath", ""), "model.safetensors")):
            mismatches.append("modelPath does not contain model.safetensors")
        if manifest.get("sequenceLengths") != [512, 1024, 2048]:
            mismatches.append(f"sequenceLengths={manifest.get('sequenceLengths')!r}")
        required_operations = {
            "attention-scale",
            "attention-softmax",
            "matmul",
            "rms-norm",
            "rope",
            "silu",
            "swiglu",
            "residual-add",
        }
        proven_operations = set(manifest.get("dispatchProof", {}).get("operations", []))
        if not required_operations.issubset(proven_operations):
            mismatches.append("dispatchProof does not cover the full encoder")
        if mismatches:
            raise RuntimeError(
                "Phoenix encoder artifact is not model-compatible: "
                + "; ".join(mismatches)
            )
