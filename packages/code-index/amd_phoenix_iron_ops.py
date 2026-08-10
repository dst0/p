"""NPU1 operator runner for the Phoenix Qwen encoder."""

import importlib.util
import os
from pathlib import Path
from typing import Any

import numpy as np
from ml_dtypes import bfloat16

import aie.iron as iron
import aie.utils.compile as aie_compile
import aie.utils.compile.jit.compilabledesign as compilable_design

from amd_phoenix_iron_designs import (
    eltwise_add,
    eltwise_mul,
    rms_norm,
    rope,
    silu,
    softmax_rows,
)


class AmdPhoenixIronOps:
    def __init__(self, source_directory: str, cache_directory: str):
        self.source_directory = source_directory
        self.cache_directory = cache_directory
        os.environ["NPU_CACHE_HOME"] = cache_directory
        cache_path = Path(cache_directory)
        aie_compile.NPU_CACHE_HOME = cache_path
        compilable_design.NPU_CACHE_HOME = cache_path
        self._whole_array = self._load_whole_array()
        self.dispatch_count = 0
        self.dispatched_operations: set[str] = set()

    def matmul(self, left: np.ndarray, right: np.ndarray) -> np.ndarray:
        left = self._bf16(left)
        right = self._bf16(right)
        if left.ndim != 2 or right.ndim != 2 or left.shape[1] != right.shape[0]:
            raise ValueError(f"invalid NPU matmul shapes: {left.shape} and {right.shape}")
        rows, shared = left.shape
        columns = right.shape[1]
        if rows % 512 or shared % 64 or columns % 128:
            raise ValueError(
                f"unsupported Phoenix matmul shape {left.shape} x {right.shape}"
            )
        result = iron.zeros((rows, columns), dtype=np.float32, device="npu")
        self._whole_array(
            self._input(left),
            self._input(right),
            result,
            M=rows,
            K=shared,
            N=columns,
            m=64,
            k=64,
            n=32,
            n_aie_cols=4,
            dtype_in_str="bf16",
            dtype_out_str="f32",
        )
        return self._finish("matmul", result, (rows, columns))

    def add(self, left: np.ndarray, right: np.ndarray) -> np.ndarray:
        return self._binary("residual-add", eltwise_add, left, right)

    def mul(self, left: np.ndarray, right: np.ndarray, operation="multiply") -> np.ndarray:
        return self._binary(operation, eltwise_mul, left, right)

    def activation(self, values: np.ndarray) -> np.ndarray:
        values = self._bf16(values)
        output = iron.zeros(values.shape, dtype=bfloat16, device="npu")
        silu(self._input(values), output, size=values.size)
        return self._finish("silu", output, values.shape)

    def normalize(self, values: np.ndarray, weight: np.ndarray) -> np.ndarray:
        values = self._bf16(values)
        rows, columns = values.shape
        repeated_weight = np.broadcast_to(self._bf16(weight), (rows, columns)).copy()
        output = iron.zeros(values.shape, dtype=bfloat16, device="npu")
        rms_norm(
            self._input(values),
            self._input(repeated_weight),
            output,
            rows=rows,
            columns=columns,
        )
        return self._finish("rms-norm", output, values.shape)

    def apply_rope(self, values: np.ndarray, lookup: np.ndarray) -> np.ndarray:
        values = self._bf16(values)
        lookup = self._bf16(lookup)
        if values.shape != lookup.shape:
            raise ValueError(f"RoPE input/LUT mismatch: {values.shape} != {lookup.shape}")
        rows, columns = values.shape
        output = iron.zeros(values.shape, dtype=bfloat16, device="npu")
        rope(
            self._input(values),
            self._input(lookup),
            output,
            rows=rows,
            columns=columns,
        )
        return self._finish("rope", output, values.shape)

    def softmax(self, values: np.ndarray) -> np.ndarray:
        values = self._bf16(values)
        rows, columns = values.shape
        output = iron.zeros(values.shape, dtype=bfloat16, device="npu")
        softmax_rows(
            self._input(values), output, rows=rows, columns=columns
        )
        return self._finish("attention-softmax", output, values.shape)

    def proof(self) -> dict[str, Any]:
        return {
            "actualExecutionDevice": "npu1",
            "dispatchCount": self.dispatch_count,
            "encoderDispatchVerified": self.dispatch_count > 0,
            "operations": sorted(self.dispatched_operations),
        }

    def _binary(self, operation, design, left, right):
        left = self._bf16(left)
        right = self._bf16(right)
        if left.shape != right.shape or left.size % 1024:
            raise ValueError(f"invalid {operation} shapes: {left.shape} and {right.shape}")
        output = iron.zeros(left.shape, dtype=bfloat16, device="npu")
        design(self._input(left), self._input(right), output, size=left.size)
        return self._finish(operation, output, left.shape)

    def _finish(self, operation, tensor, shape):
        self.dispatch_count += 1
        self.dispatched_operations.add(operation)
        return tensor.numpy().reshape(shape).astype(bfloat16)

    @staticmethod
    def _input(values):
        return iron.tensor(values, dtype=bfloat16, device="npu")

    @staticmethod
    def _bf16(values):
        return np.asarray(values, dtype=bfloat16, order="C")

    def _load_whole_array(self):
        source = Path(self.source_directory) / (
            "programming_examples/basic/matrix_multiplication/whole_array/whole_array.py"
        )
        if not source.is_file():
            raise RuntimeError(f"Pinned MLIR-AIE matrix design is missing: {source}")
        spec = importlib.util.spec_from_file_location("p_mlir_aie_whole_array", source)
        if spec is None or spec.loader is None:
            raise RuntimeError(f"Unable to load MLIR-AIE matrix design: {source}")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.whole_array
