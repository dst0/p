import unittest

from resource_manager import (
    GIB,
    MemorySnapshot,
    build_runtime_plan,
    estimate_model_parameter_count,
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

    def test_uses_bfloat16_for_mps_to_reduce_unified_memory(self):
        plan = build_runtime_plan(
            preferred_backend="mps",
            logical_cpu_count=12,
            memory=MemorySnapshot(
                system_total_bytes=24 * GIB,
                system_available_bytes=8 * GIB,
                accelerator_total_bytes=24 * GIB,
                accelerator_free_bytes=8 * GIB,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "mps")
        self.assertEqual(plan.dtype, "bfloat16")
        self.assertEqual(plan.model_bytes, 1_200_000_000)

    def test_falls_back_to_parallel_cpu_when_vram_and_system_memory_are_low(self):
        plan = build_runtime_plan(
            preferred_backend="rocm",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=16 * GIB,
                system_available_bytes=12 * GIB,
                accelerator_total_bytes=1 * GIB,
                accelerator_free_bytes=1 * GIB,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "cpu")
        self.assertEqual(plan.cpu_threads, 2)
        self.assertEqual(plan.batch_size, 2)
        self.assertIn("below the safety reserve", plan.reason or "")

    def test_does_not_fall_back_from_requested_npu_to_cpu(self):
        plan = build_runtime_plan(
            preferred_backend="amd-phoenix-npu",
            logical_cpu_count=16,
            memory=MemorySnapshot(
                system_total_bytes=16 * GIB,
                system_available_bytes=3 * GIB,
                accelerator_total_bytes=0,
                accelerator_free_bytes=0,
            ),
            model_parameter_count=600_000_000,
        )

        self.assertFalse(plan.usable)
        self.assertEqual(plan.backend, "none")
        self.assertEqual(plan.device, "none")
        self.assertNotEqual(plan.backend, "cpu")
        self.assertIn("amd-phoenix-npu memory headroom", plan.reason or "")

    def test_uses_rocm_apu_unified_memory_when_system_memory_has_headroom(self):
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
        self.assertEqual(plan.backend, "rocm")
        self.assertEqual(plan.device, "cuda")
        self.assertEqual(plan.dtype, "float16")

    def test_reduces_cpu_parallelism_when_system_memory_is_limited(self):
        plan = build_runtime_plan(
            preferred_backend="cpu",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=16 * GIB,
                system_available_bytes=8 * GIB,
            ),
            model_parameter_count=600_000_000,
            max_cpu_threads=32,
        )

        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "cpu")
        self.assertEqual(plan.cpu_threads, 8)
        self.assertEqual(plan.batch_size, 2)

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
        self.assertEqual(plan.batch_size, 2)

    def test_reduces_batch_for_longer_sequence_length(self):
        common_options = {
            "preferred_backend": "rocm",
            "logical_cpu_count": 32,
            "memory": MemorySnapshot(
                system_total_bytes=64 * GIB,
                system_available_bytes=48 * GIB,
                accelerator_total_bytes=16 * GIB,
                accelerator_free_bytes=12 * GIB,
            ),
            "model_parameter_count": 600_000_000,
        }

        default_context = build_runtime_plan(**common_options, sequence_length=2048)
        long_context = build_runtime_plan(**common_options, sequence_length=4096)

        self.assertEqual(default_context.batch_size, 64)
        self.assertLess(long_context.batch_size, default_context.batch_size)

    def test_estimates_parameter_count_from_model_name(self):
        self.assertEqual(estimate_model_parameter_count("Qwen/Qwen3-Embedding-0.6B"), 600_000_000)
        self.assertEqual(estimate_model_parameter_count("acme/embed-2B"), 2_000_000_000)

    def test_caps_workspace_to_fifty_percent_max(self):
        plan = build_runtime_plan(
            preferred_backend="rocm",
            logical_cpu_count=32,
            memory=MemorySnapshot(
                system_total_bytes=64 * GIB,
                system_available_bytes=48 * GIB,
                accelerator_total_bytes=16 * GIB,
                accelerator_free_bytes=4 * GIB,
            ),
            model_parameter_count=600_000_000,
        )
        self.assertTrue(plan.usable)
        self.assertEqual(plan.backend, "rocm")
        self.assertLessEqual(plan.batch_size, 32)


if __name__ == "__main__":
    unittest.main()
