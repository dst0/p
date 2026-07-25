import os
import unittest
from unittest.mock import patch

from resource_manager import (
    GIB,
    MemorySnapshot,
    build_runtime_plan,
    estimate_model_parameter_count,
    read_positive_int_environment,
)


class ResourceManagerTest(unittest.TestCase):
    def test_uses_rocm_when_model_and_reserve_fit(self):
        plan = build_runtime_plan(
            preferred_backend="rocm",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=64 * GIB,
                system_available_bytes=48 * GIB,
                accelerator_total_bytes=16 * GIB,
                accelerator_free_bytes=12 * GIB,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "rocm")
        self.assertEqual(plan.device, "cuda")
        self.assertEqual(plan.dtype, "float16")
        self.assertEqual(plan.batch_size, 64)

    def test_falls_back_to_parallel_cpu_with_only_one_gibibyte_free_vram(self):
        plan = build_runtime_plan(
            preferred_backend="rocm",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=64 * GIB,
                system_available_bytes=48 * GIB,
                accelerator_total_bytes=16 * GIB,
                accelerator_free_bytes=1 * GIB,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "cpu")
        self.assertEqual(plan.cpu_threads, 32)
        self.assertEqual(plan.batch_size, 64)
        self.assertIn("below the safety reserve", plan.reason or "")

    def test_reduces_cpu_parallelism_when_system_memory_is_limited(self):
        plan = build_runtime_plan(
            preferred_backend="cpu",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=16 * GIB,
                system_available_bytes=8 * GIB,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "cpu")
        self.assertEqual(plan.cpu_threads, 7)
        self.assertEqual(plan.batch_size, 16)

    def test_refuses_to_load_when_neither_accelerator_nor_system_memory_is_safe(self):
        plan = build_runtime_plan(
            preferred_backend="rocm",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=8 * GIB,
                system_available_bytes=2 * GIB,
                accelerator_total_bytes=16 * GIB,
                accelerator_free_bytes=1 * GIB,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertFalse(plan.usable)
        self.assertEqual(plan.backend, "none")
        self.assertEqual(plan.batch_size, 0)
        self.assertIn("insufficient", plan.reason or "")

    def test_honors_safe_thread_and_batch_caps(self):
        plan = build_runtime_plan(
            preferred_backend="cpu",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=64 * GIB,
                system_available_bytes=48 * GIB,
            ),
            model_parameter_count=600_000_000,
            max_batch_size=20,
            max_cpu_threads=12,
        )

        self.assertEqual(plan.cpu_threads, 12)
        self.assertEqual(plan.batch_size, 16)

    def test_reduces_batch_for_longer_sequence_length(self):
        common_options = {
            "preferred_backend": "cpu",
            "logical_cpu_count": 32,
            "memory": MemorySnapshot(
                system_total_bytes=16 * GIB,
                system_available_bytes=8 * GIB,
            ),
            "model_parameter_count": 600_000_000,
        }

        default_context = build_runtime_plan(**common_options, sequence_length=2048)
        long_context = build_runtime_plan(**common_options, sequence_length=4096)

        self.assertEqual(default_context.batch_size, 16)
        self.assertEqual(long_context.batch_size, 4)

    def test_estimates_parameter_count_from_model_name(self):
        self.assertEqual(estimate_model_parameter_count("Qwen/Qwen3-Embedding-0.6B"), 600_000_000)
        self.assertEqual(estimate_model_parameter_count("acme/embed-2B"), 2_000_000_000)

    def test_rejects_invalid_positive_integer_environment_override(self):
        with patch.dict(os.environ, {"P_CODE_RAG_MAX_EMBED_BATCH_SIZE": "0"}):
            with self.assertRaisesRegex(ValueError, "must be a positive integer"):
                read_positive_int_environment("P_CODE_RAG_MAX_EMBED_BATCH_SIZE", 64)


if __name__ == "__main__":
    unittest.main()
