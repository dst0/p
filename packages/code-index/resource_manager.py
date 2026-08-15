#!/usr/bin/env python3
"""Resource planning primitives for the local embedding server."""

from __future__ import annotations

import os
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
MIB = 1024**2
GIB = 1024**3

DEFAULT_MODEL_PARAMETER_COUNT = 1_000_000_000
DEFAULT_MAX_BATCH_SIZE = 64
MIN_SYSTEM_RESERVE_BYTES = 1 * GIB
MAX_SYSTEM_RESERVE_BYTES = 4 * GIB
MIN_ACCELERATOR_RESERVE_BYTES = 512 * MIB
MIN_RUNTIME_WORKSPACE_BYTES = 512 * MIB
CPU_BATCH_ITEM_BYTES = 128 * MIB
ACCELERATOR_BATCH_ITEM_BYTES = 64 * MIB
CPU_THREAD_HEADROOM_BYTES = 384 * MIB
CPU_THREAD_WORKSPACE_BYTES = 64 * MIB


@dataclass(frozen=True)
class MemorySnapshot:
    system_total_bytes: int
    system_available_bytes: int
    accelerator_total_bytes: int | None = None
    accelerator_free_bytes: int | None = None


@dataclass(frozen=True)
class RuntimePlan:
    usable: bool
    preferred_backend: str
    backend: str
    device: str
    dtype: str
    batch_size: int
    cpu_threads: int
    model_bytes: int
    system_reserve_bytes: int
    accelerator_reserve_bytes: int
    reason: str | None

    def to_dict(self) -> dict[str, bool | int | str | None]:
        return asdict(self)


SUPPORTED_BACKENDS = {
    "cpu",
    "cuda",
    "rocm",
    "mps",
    "npu",
    "openvino",
    "coreml",
    "vitisai",
    "apple-ane",
    "nvidia-cuda",
    "amd-rocm",
    "apple-mps",
    "intel-openvino-cpu",
    "amd-phoenix-npu",
    "amd-ryzenai-npu",
}
SHARED_MEMORY_ACCELERATORS = {
    "npu", "openvino", "coreml", "vitisai", "apple-ane", "amd-phoenix-npu", "amd-ryzenai-npu"
}
FAIL_CLOSED_ACCELERATORS = {
    "npu", "openvino", "vitisai", "apple-ane", "amd-phoenix-npu", "amd-ryzenai-npu"
}


def estimate_model_parameter_count(model_name: str) -> int:
    size_match = re.search(r"(?<![a-z0-9])(\d+(?:\.\d+)?)b(?![a-z0-9])", model_name.lower())
    if size_match:
        return max(1, int(float(size_match.group(1)) * 1_000_000_000))
    return DEFAULT_MODEL_PARAMETER_COUNT


def system_memory_snapshot() -> MemorySnapshot:
    total, available = _host_memory()
    cgroup_total, cgroup_available = _cgroup_memory()
    if cgroup_total is not None:
        total = min(total, cgroup_total)
    if cgroup_available is not None:
        available = min(available, cgroup_available)
    return MemorySnapshot(
        system_total_bytes=max(0, total),
        system_available_bytes=max(0, min(available, total)),
    )


def build_runtime_plan(
    *,
    preferred_backend: str,
    logical_cpu_count: int,
    memory: MemorySnapshot,
    model_parameter_count: int,
    sequence_length: int = 2048,
    mps_precision: str = "bfloat16",
    max_batch_size: int = DEFAULT_MAX_BATCH_SIZE,
    max_cpu_threads: int | None = None,
    min_system_reserve_bytes: int = MIN_SYSTEM_RESERVE_BYTES,
    min_accelerator_reserve_bytes: int = MIN_ACCELERATOR_RESERVE_BYTES,
    model_resident: bool = False,
) -> RuntimePlan:
    if preferred_backend not in SUPPORTED_BACKENDS:
        raise ValueError(f"Unsupported backend: {preferred_backend}")
    if logical_cpu_count <= 0:
        raise ValueError("logical_cpu_count must be positive")
    if model_parameter_count <= 0:
        raise ValueError("model_parameter_count must be positive")
    if sequence_length <= 0:
        raise ValueError("sequence_length must be positive")
    if max_batch_size <= 0:
        raise ValueError("max_batch_size must be positive")
    if max_cpu_threads is not None and max_cpu_threads <= 0:
        raise ValueError("max_cpu_threads must be positive")
    if mps_precision not in {"bfloat16", "float32"}:
        raise ValueError("mps_precision must be bfloat16 or float32")

    system_reserve = max(
        min_system_reserve_bytes,
        min(2 * GIB, int(memory.system_available_bytes * 0.25)),
    )
    accelerator_total = memory.accelerator_total_bytes or 0
    accelerator_reserve = (
        max(min_accelerator_reserve_bytes, int(accelerator_total * 0.10)) if preferred_backend != "cpu" else 0
    )
    cpu_model_bytes = model_parameter_count * 4
    accelerator_float32 = preferred_backend == "coreml" or preferred_backend == "mps" and mps_precision == "float32"
    accelerator_model_bytes = model_parameter_count * (4 if accelerator_float32 else 2)
    cpu_load_bytes = 0 if model_resident else int(cpu_model_bytes * 1.20)
    accelerator_load_bytes = 0 if model_resident else int(accelerator_model_bytes * 1.20)
    cpu_workspace = memory.system_available_bytes - system_reserve - cpu_load_bytes
    cpu_fits = cpu_workspace >= MIN_RUNTIME_WORKSPACE_BYTES

    def unusable_plan(model_bytes: int, reserve_bytes: int, reason: str) -> RuntimePlan:
        return RuntimePlan(
            usable=False,
            preferred_backend=preferred_backend,
            backend="none",
            device="none",
            dtype="none",
            batch_size=0,
            cpu_threads=1,
            model_bytes=model_bytes,
            system_reserve_bytes=system_reserve,
            accelerator_reserve_bytes=reserve_bytes,
            reason=reason,
        )

    selected_backend = preferred_backend
    reason = None
    if preferred_backend != "cpu":
        accelerator_free = memory.accelerator_free_bytes
        if preferred_backend in SHARED_MEMORY_ACCELERATORS or (
            preferred_backend == "rocm"
            and accelerator_free is not None
            and accelerator_total >= 2 * GIB
            and accelerator_free - accelerator_reserve - accelerator_load_bytes < MIN_RUNTIME_WORKSPACE_BYTES
        ):
            system_apu_headroom = memory.system_available_bytes - system_reserve - accelerator_load_bytes
            if system_apu_headroom >= MIN_RUNTIME_WORKSPACE_BYTES:
                accelerator_free = max(accelerator_free or 0, memory.system_available_bytes - system_reserve)
                accelerator_reserve = min(accelerator_reserve, MIN_ACCELERATOR_RESERVE_BYTES)
        accelerator_fits = (
            accelerator_free is not None
            and (accelerator_total > 0 or preferred_backend in SHARED_MEMORY_ACCELERATORS)
            and accelerator_free - accelerator_reserve - accelerator_load_bytes >= MIN_RUNTIME_WORKSPACE_BYTES
        )
        system_staging_bytes = 0 if model_resident else int(accelerator_model_bytes * 1.10)
        system_staging_fits = (
            memory.system_available_bytes - system_reserve - system_staging_bytes >= MIN_RUNTIME_WORKSPACE_BYTES
        )
        if not accelerator_fits or not system_staging_fits:
            if preferred_backend in FAIL_CLOSED_ACCELERATORS:
                return unusable_plan(accelerator_model_bytes, accelerator_reserve, f"{preferred_backend} memory headroom is below the safety reserve")
            if not cpu_fits:
                return unusable_plan(cpu_model_bytes, accelerator_reserve, "insufficient accelerator and system memory")
            selected_backend = "cpu"
            reason = (
                f"{preferred_backend} memory headroom is below the safety reserve; "
                "using CPU until accelerator memory is available"
            )
    elif not cpu_fits:
        return unusable_plan(cpu_model_bytes, 0, "insufficient system memory for the embedding model and safety reserve")
    default_cpu_thread_limit = (
        min(2, max(1, logical_cpu_count // 4)) if max_cpu_threads is None else max_cpu_threads
    )
    thread_limit = min(logical_cpu_count, default_cpu_thread_limit)
    selected_model_bytes = cpu_model_bytes if selected_backend == "cpu" else accelerator_model_bytes
    sequence_scale = max(0.25, (sequence_length / 2048) ** 2)
    model_scale = max(0.5, (model_parameter_count / 600_000_000) ** 0.5)
    if selected_backend == "cpu":
        max_cpu_workspace = int(memory.system_available_bytes * 0.50)
        workspace = max(0, min(cpu_workspace, max_cpu_workspace))
        memory_thread_limit = max(1, workspace // CPU_THREAD_HEADROOM_BYTES)
        cpu_threads = min(thread_limit, memory_thread_limit)
        remaining_workspace = max(0, workspace - cpu_threads * CPU_THREAD_WORKSPACE_BYTES)
        batch_item_bytes = max(1, int(CPU_BATCH_ITEM_BYTES * sequence_scale * model_scale))
        batch_capacity = max(1, remaining_workspace // batch_item_bytes)
        cpu_core_batch_cap = min(2, max(1, int((cpu_threads * 2) / (sequence_scale * model_scale))))
        effective_max_batch = min(max_batch_size, cpu_core_batch_cap)
    else:
        accelerator_free = memory.accelerator_free_bytes or 0
        max_accelerator_workspace = int(accelerator_free * 0.50)
        accelerator_workspace = max(
            0,
            min(accelerator_free - accelerator_reserve - accelerator_load_bytes, max_accelerator_workspace),
        )
        backend_thread_limit = 4 if selected_backend == "mps" else 8
        cpu_threads = min(thread_limit, backend_thread_limit)
        batch_item_bytes = max(1, int(ACCELERATOR_BATCH_ITEM_BYTES * sequence_scale * model_scale))
        batch_capacity = max(1, accelerator_workspace // batch_item_bytes)
        effective_max_batch = max_batch_size
    batch_size = _power_of_two_floor(min(effective_max_batch, batch_capacity))
    if reason is None and (cpu_threads < thread_limit or batch_size < max_batch_size):
        reason = "parallelism reduced to preserve memory headroom"

    return RuntimePlan(
        usable=True,
        preferred_backend=preferred_backend,
        backend=selected_backend,
        device="cuda" if selected_backend in {"cuda", "rocm"} else selected_backend,
        dtype=mps_precision if selected_backend == "mps" else "float32" if selected_backend in {"cpu", "coreml", "npu", "openvino", "vitisai", "amd-phoenix-npu", "amd-ryzenai-npu"} else "float16",
        batch_size=batch_size,
        cpu_threads=cpu_threads,
        model_bytes=selected_model_bytes,
        system_reserve_bytes=system_reserve,
        accelerator_reserve_bytes=accelerator_reserve,
        reason=reason,
    )


def _power_of_two_floor(value: int) -> int:
    return 1 << (max(1, int(value)).bit_length() - 1)


def _host_memory() -> tuple[int, int]:
    meminfo_path = Path("/proc/meminfo")
    if meminfo_path.is_file():
        values: dict[str, int] = {}
        try:
            lines = meminfo_path.read_text(encoding="utf-8").splitlines()
        except OSError:
            lines = []
        for line in lines:
            key, separator, raw_value = line.partition(":")
            if not separator:
                continue
            value_match = re.search(r"\d+", raw_value)
            if value_match:
                values[key] = int(value_match.group(0)) * 1024
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", values.get("MemFree", 0))
        if total > 0:
            return total, min(available, total)

    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        total_pages = os.sysconf("SC_PHYS_PAGES")
        total = int(page_size * total_pages)
    except (OSError, TypeError, ValueError):
        total = 0
    available = _macos_available_memory(total)
    if available is None:
        available = total // 2
    return total, min(available, total)


def _macos_available_memory(total: int) -> int | None:
    if sys_platform() != "darwin":
        return None
    try:
        output = subprocess.run(
            ["vm_stat"],
            check=True,
            capture_output=True,
            text=True,
            timeout=2,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    page_size_match = re.search(r"page size of (\d+) bytes", output)
    if not page_size_match:
        return None
    page_size = int(page_size_match.group(1))
    available_pages = 0
    for name in ("Pages free", "Pages inactive", "Pages speculative", "Pages purgeable"):
        value_match = re.search(rf"^{re.escape(name)}:\s+(\d+)\.", output, re.MULTILINE)
        if value_match:
            available_pages += int(value_match.group(1))
    return min(total, available_pages * page_size)


def _cgroup_memory() -> tuple[int | None, int | None]:
    v2_max = _read_cgroup_value(Path("/sys/fs/cgroup/memory.max"))
    v2_current = _read_cgroup_value(Path("/sys/fs/cgroup/memory.current"))
    if v2_max is not None:
        return v2_max, max(0, v2_max - (v2_current or 0))

    v1_max = _read_cgroup_value(Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"))
    v1_current = _read_cgroup_value(Path("/sys/fs/cgroup/memory/memory.usage_in_bytes"))
    if v1_max is not None:
        return v1_max, max(0, v1_max - (v1_current or 0))
    return None, None


def _read_cgroup_value(file_path: Path) -> int | None:
    try:
        raw_value = file_path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    if raw_value == "max":
        return None
    try:
        value = int(raw_value)
    except ValueError:
        return None
    if value <= 0 or value >= 1 << 60:
        return None
    return value


def sys_platform() -> str:
    return os.uname().sysname.lower() if hasattr(os, "uname") else os.name
