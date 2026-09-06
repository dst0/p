"""Unit tests for immutable Core AI candidate generations and atomic pointer resolution."""

import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from apple_coreai_artifact_locator import (
    CANONICAL_ARTIFACT_VERSION,
    CANONICAL_MODEL_ID,
    EXPECTED_BATCH_SIZE,
    EXPECTED_SEQUENCE_LENGTH,
    resolve_coreai_artifact,
    validate_generation_name,
)


def _valid_metadata() -> dict:
    return {
        "artifactVersion": CANONICAL_ARTIFACT_VERSION,
        "model": CANONICAL_MODEL_ID,
        "batchSize": EXPECTED_BATCH_SIZE,
        "sequenceLength": EXPECTED_SEQUENCE_LENGTH,
    }


class AppleCoreAIArtifactGenerationsTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = Path(tempfile.mkdtemp()).resolve()

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_validate_generation_name_accepts_valid_uuid_and_rejects_invalid(self):
        valid = f"{CANONICAL_ARTIFACT_VERSION}-12345678-1234-4321-8765-123456789abc"
        validate_generation_name(valid)

        for invalid in [
            "",
            f"other-version-12345678-1234-4321-8765-123456789abc",
            f"{CANONICAL_ARTIFACT_VERSION}-not-a-uuid",
            f"{CANONICAL_ARTIFACT_VERSION}/../escape",
            f"/{CANONICAL_ARTIFACT_VERSION}-12345678-1234-4321-8765-123456789abc",
        ]:
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValueError):
                    validate_generation_name(invalid)

    def test_build_candidate_creates_immutable_destination_and_no_current_json(self):
        mock_modules = {
            "torch": Mock(),
            "torch.export": Mock(),
            "coreai_torch": Mock(),
            "coreai_models": Mock(),
            "coreai_models.export": Mock(),
            "coreai_models.export.mlir_ops": Mock(),
            "coreai_models.models": Mock(),
            "coreai_models.models.ios": Mock(),
            "coreai_models.models.ios.qwen3": Mock(),
            "apple_coreai_model": Mock(),
            "safetensors": Mock(),
            "safetensors.torch": Mock(),
            "transformers": Mock(),
            "huggingface_hub": Mock(),
        }
        with patch.dict("sys.modules", mock_modules):
            import apple_coreai_artifact

            gen = f"{CANONICAL_ARTIFACT_VERSION}-a1b2c3d4-e5f6-4a1b-8c2d-0e1f2a3b4c5d"
            with patch.object(apple_coreai_artifact, "export_asset") as mock_export:
                def fake_export(dest: Path):
                    dest.mkdir(parents=True, exist_ok=True)
                    (dest / "artifact.json").write_text(json.dumps(_valid_metadata()))

                mock_export.side_effect = fake_export
                dest = apple_coreai_artifact.build_candidate(self.temp_dir, gen)
                self.assertEqual(dest, self.temp_dir / gen)
                self.assertTrue(dest.is_dir())
                self.assertFalse((self.temp_dir / "current.json").exists())

    def test_build_candidate_rejects_collision_and_broken_symlink_and_cleans_temporary(self):
        mock_modules = {
            "torch": Mock(),
            "torch.export": Mock(),
            "coreai_torch": Mock(),
            "coreai_models": Mock(),
            "coreai_models.export": Mock(),
            "coreai_models.export.mlir_ops": Mock(),
            "coreai_models.models": Mock(),
            "coreai_models.models.ios": Mock(),
            "coreai_models.models.ios.qwen3": Mock(),
            "apple_coreai_model": Mock(),
            "safetensors": Mock(),
            "safetensors.torch": Mock(),
            "transformers": Mock(),
            "huggingface_hub": Mock(),
        }
        with patch.dict("sys.modules", mock_modules):
            import apple_coreai_artifact

            gen = f"{CANONICAL_ARTIFACT_VERSION}-b2c3d4e5-f6a1-4b2c-9d3e-1f2a3b4c5d6e"
            existing = self.temp_dir / gen
            existing.mkdir(parents=True, exist_ok=True)
            (existing / "sentinel.txt").write_text("prior")

            with self.assertRaises(FileExistsError):
                apple_coreai_artifact.build_candidate(self.temp_dir, gen)

            broken_gen = f"{CANONICAL_ARTIFACT_VERSION}-b2c3d4e5-f6a1-4b2c-9d3e-1f2a3b4c5d6f"
            broken_path = self.temp_dir / broken_gen
            broken_path.symlink_to(self.temp_dir / "nonexistent")
            with self.assertRaises(FileExistsError):
                apple_coreai_artifact.build_candidate(self.temp_dir, broken_gen)

            gen_fail = f"{CANONICAL_ARTIFACT_VERSION}-c3d4e5f6-a1b2-4c3d-ae4f-2a3b4c5d6e7f"
            with patch.object(apple_coreai_artifact, "export_asset", side_effect=RuntimeError("export failed")):
                with self.assertRaises(RuntimeError):
                    apple_coreai_artifact.build_candidate(self.temp_dir, gen_fail)
            self.assertFalse((self.temp_dir / gen_fail).exists())
            self.assertEqual(list(self.temp_dir.glob(f".building-{gen_fail}-*")), [])

    def test_locator_requires_mutually_exclusive_root_and_directory(self):
        with self.assertRaises(ValueError):
            resolve_coreai_artifact()
        with self.assertRaises(ValueError):
            resolve_coreai_artifact(artifact_root=self.temp_dir, artifact_directory=self.temp_dir)

    def test_locator_resolves_new_artifact_directory_pointer(self):
        gen = f"{CANONICAL_ARTIFACT_VERSION}-d4e5f6a1-b2c3-4d4e-bf5a-3a3b4c5d6e7f"
        gen_dir = self.temp_dir / gen
        gen_dir.mkdir(parents=True, exist_ok=True)
        (gen_dir / "artifact.json").write_text(json.dumps(_valid_metadata()))
        (self.temp_dir / "current.json").write_text(json.dumps({
            "artifactVersion": CANONICAL_ARTIFACT_VERSION,
            "artifactDirectory": gen,
        }))

        resolved, bsz, seq = resolve_coreai_artifact(artifact_root=self.temp_dir)
        self.assertEqual(resolved, gen_dir)
        self.assertEqual(bsz, 1)
        self.assertEqual(seq, 64)

    def test_locator_resolves_legacy_artifact_version_pointer(self):
        legacy_dir = self.temp_dir / CANONICAL_ARTIFACT_VERSION
        legacy_dir.mkdir(parents=True, exist_ok=True)
        (legacy_dir / "artifact.json").write_text(json.dumps(_valid_metadata()))
        (self.temp_dir / "current.json").write_text(json.dumps({
            "artifactVersion": CANONICAL_ARTIFACT_VERSION,
        }))

        resolved, bsz, seq = resolve_coreai_artifact(artifact_root=self.temp_dir)
        self.assertEqual(resolved, legacy_dir)
        self.assertEqual(bsz, 1)
        self.assertEqual(seq, 64)

    def test_locator_resolves_explicit_candidate_directory(self):
        gen_dir = self.temp_dir / "explicit_candidate"
        gen_dir.mkdir(parents=True, exist_ok=True)
        (gen_dir / "artifact.json").write_text(json.dumps(_valid_metadata()))

        resolved, bsz, seq = resolve_coreai_artifact(artifact_directory=gen_dir)
        self.assertEqual(resolved, gen_dir)
        self.assertEqual(bsz, 1)
        self.assertEqual(seq, 64)

    def test_locator_fails_closed_on_pointer_issues(self):
        # Missing current.json
        with self.assertRaises(RuntimeError):
            resolve_coreai_artifact(artifact_root=self.temp_dir)

        # Symlink current.json
        real_ptr = self.temp_dir / "real_ptr.json"
        real_ptr.write_text(json.dumps({"artifactVersion": CANONICAL_ARTIFACT_VERSION}))
        current_sym = self.temp_dir / "current.json"
        current_sym.symlink_to(real_ptr)
        with self.assertRaises(ValueError):
            resolve_coreai_artifact(artifact_root=self.temp_dir)
        current_sym.unlink()

        # Pointer artifactVersion mismatch
        (self.temp_dir / "current.json").write_text(json.dumps({"artifactVersion": "mismatch-v2"}))
        with self.assertRaises(ValueError):
            resolve_coreai_artifact(artifact_root=self.temp_dir)

        # Empty artifactDirectory (must not fallback)
        (self.temp_dir / "current.json").write_text(json.dumps({
            "artifactVersion": CANONICAL_ARTIFACT_VERSION,
            "artifactDirectory": "",
        }))
        with self.assertRaises(ValueError):
            resolve_coreai_artifact(artifact_root=self.temp_dir)

        # Traversal in artifactDirectory
        (self.temp_dir / "current.json").write_text(json.dumps({
            "artifactVersion": CANONICAL_ARTIFACT_VERSION,
            "artifactDirectory": "../outside",
        }))
        with self.assertRaises(ValueError):
            resolve_coreai_artifact(artifact_root=self.temp_dir)

        # Absolute path in artifactDirectory
        (self.temp_dir / "current.json").write_text(json.dumps({
            "artifactVersion": CANONICAL_ARTIFACT_VERSION,
            "artifactDirectory": "/tmp",
        }))
        with self.assertRaises(ValueError):
            resolve_coreai_artifact(artifact_root=self.temp_dir)

        # Symlink candidate directory
        outside = (self.temp_dir.parent / "outside_dir").resolve()
        outside.mkdir(exist_ok=True)
        (outside / "artifact.json").write_text(json.dumps(_valid_metadata()))
        symlink_gen = self.temp_dir / "symlink_gen"
        try:
            symlink_gen.symlink_to(outside)
            (self.temp_dir / "current.json").write_text(json.dumps({
                "artifactVersion": CANONICAL_ARTIFACT_VERSION,
                "artifactDirectory": "symlink_gen",
            }))
            with self.assertRaises(ValueError):
                resolve_coreai_artifact(artifact_root=self.temp_dir)

            # Explicit candidate symlink
            with self.assertRaises(ValueError):
                resolve_coreai_artifact(artifact_directory=symlink_gen)
        finally:
            shutil.rmtree(outside, ignore_errors=True)

        # Symlink artifact.json inside candidate
        gen_dir = self.temp_dir / "candidate_with_symlink_json"
        gen_dir.mkdir(exist_ok=True)
        outside_json = (self.temp_dir.parent / "outside_artifact.json").resolve()
        outside_json.write_text(json.dumps(_valid_metadata()))
        try:
            (gen_dir / "artifact.json").symlink_to(outside_json)
            (self.temp_dir / "current.json").write_text(json.dumps({
                "artifactVersion": CANONICAL_ARTIFACT_VERSION,
                "artifactDirectory": "candidate_with_symlink_json",
            }))
            with self.assertRaises(ValueError):
                resolve_coreai_artifact(artifact_root=self.temp_dir)
        finally:
            if outside_json.exists():
                outside_json.unlink()

    def test_locator_fails_closed_on_metadata_issues(self):
        gen_dir = self.temp_dir / "gen_meta_test"
        gen_dir.mkdir(parents=True, exist_ok=True)
        (self.temp_dir / "current.json").write_text(json.dumps({
            "artifactVersion": CANONICAL_ARTIFACT_VERSION,
            "artifactDirectory": "gen_meta_test",
        }))

        cases = [
            ("wrong version", {**_valid_metadata(), "artifactVersion": "wrong-v1"}),
            ("wrong model", {**_valid_metadata(), "model": "other-model"}),
            ("batchSize boolean", {**_valid_metadata(), "batchSize": True}),
            ("batchSize string", {**_valid_metadata(), "batchSize": "1"}),
            ("batchSize not 1", {**_valid_metadata(), "batchSize": 2}),
            ("sequenceLength boolean", {**_valid_metadata(), "sequenceLength": True}),
            ("sequenceLength string", {**_valid_metadata(), "sequenceLength": "64"}),
            ("sequenceLength not 64", {**_valid_metadata(), "sequenceLength": 128}),
        ]
        for name, meta in cases:
            with self.subTest(case=name):
                (gen_dir / "artifact.json").write_text(json.dumps(meta))
                with self.assertRaises(RuntimeError):
                    resolve_coreai_artifact(artifact_root=self.temp_dir)

    def test_worker_rejects_explicit_candidate_symlink(self):
        """Regression: AppleCoreAIWorker must not resolve() away a symlink before locator validation."""
        mock_modules = {
            "coreai": Mock(),
            "coreai.runtime": Mock(),
            "transformers": Mock(),
        }
        with patch.dict("sys.modules", mock_modules):
            from apple_coreai_worker import AppleCoreAIWorker

            real_dir = self.temp_dir / "real_artifact"
            real_dir.mkdir(parents=True, exist_ok=True)
            (real_dir / "artifact.json").write_text(json.dumps(_valid_metadata()))
            symlink_dir = self.temp_dir / "sym_artifact"
            symlink_dir.symlink_to(real_dir)

            worker = AppleCoreAIWorker(artifact_directory=symlink_dir)
            with self.assertRaises(ValueError, msg="Symlink artifact_directory must be rejected"):
                worker._resolve_artifact()


if __name__ == "__main__":
    unittest.main()
