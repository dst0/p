"""IRON designs used by the Phoenix Qwen encoder."""

from pathlib import Path

import numpy as np
from ml_dtypes import bfloat16

import aie.iron as iron
from aie.helpers.taplib import TensorTiler2D
from aie.iron import CompileTime, In, ObjectFifo, Out, Program, Runtime, Worker, kernels
from aie.iron.algorithms import transform_parallel, transform_parallel_binary
from aie.iron.controlflow import range_
from aie.iron.kernel import ExternalFunction
from aie.utils import config

_SOURCE_ROOT = Path(__file__).resolve().parent


@iron.jit
def eltwise_add(a_in: In, b_in: In, c_out: Out, *, size: CompileTime[int]):
    tensor_type = np.ndarray[(size,), np.dtype[bfloat16]]
    return transform_parallel_binary(
        kernels.add(),
        tensor_type,
        tile_size=1024,
        num_channels=1,
        pass_size_to_kernel=False,
    )


@iron.jit
def eltwise_mul(a_in: In, b_in: In, c_out: Out, *, size: CompileTime[int]):
    tensor_type = np.ndarray[(size,), np.dtype[bfloat16]]
    return transform_parallel_binary(
        kernels.mul(),
        tensor_type,
        tile_size=1024,
        num_channels=1,
        pass_size_to_kernel=False,
    )


@iron.jit
def silu(a_in: In, b_out: Out, *, size: CompileTime[int]):
    tensor_type = np.ndarray[(size,), np.dtype[bfloat16]]
    return transform_parallel(
        kernels.silu(),
        tensor_type,
        tile_size=1024,
        num_channels=1,
        pass_size_to_kernel=False,
    )


def _external_design(rows, columns, symbol, source_name):
    device = iron.get_current_device()
    core_count = 4
    if rows % core_count:
        raise ValueError(f"row count {rows} must be divisible by {core_count}")
    rows_per_core = rows // core_count
    tensor_type = np.ndarray[(rows, columns), np.dtype[bfloat16]]
    row_type = np.ndarray[(columns,), np.dtype[bfloat16]]
    inputs = [ObjectFifo(row_type, name=f"input_{index}") for index in range(core_count)]
    parameters = [ObjectFifo(row_type, name=f"parameter_{index}") for index in range(core_count)]
    outputs = [ObjectFifo(row_type, name=f"output_{index}") for index in range(core_count)]
    external = ExternalFunction(
        symbol,
        source_file=str(_SOURCE_ROOT / source_name),
        arg_types=[row_type, row_type, row_type, np.int32],
        include_dirs=[config.cxx_header_path()],
    )

    def core(input_fifo, parameter_fifo, output_fifo, kernel):
        for _ in range_(rows_per_core):
            input_row = input_fifo.acquire(1)
            parameter_row = parameter_fifo.acquire(1)
            output_row = output_fifo.acquire(1)
            kernel(input_row, parameter_row, output_row, columns)
            input_fifo.release(1)
            parameter_fifo.release(1)
            output_fifo.release(1)

    workers = [
        Worker(
            core,
            [
                inputs[index].cons(),
                parameters[index].cons(),
                outputs[index].prod(),
                external,
            ],
        )
        for index in range(core_count)
    ]
    taps = TensorTiler2D.simple_tiler(
        (rows, columns), (rows_per_core, columns)
    )

    def sequence(a, parameter, result, input_producers, parameter_producers, output_consumers):
        for index in range(core_count):
            input_producers[index].fill(a, taps[index])
            parameter_producers[index].fill(parameter, taps[index])
        for index in range(core_count):
            output_consumers[index].drain(result, taps[index], wait=True)

    runtime = Runtime(
        sequence,
        [
            tensor_type,
            tensor_type,
            tensor_type,
            [fifo.prod() for fifo in inputs],
            [fifo.prod() for fifo in parameters],
            [fifo.cons() for fifo in outputs],
        ],
    )
    return Program(device, runtime, workers=workers).resolve_program()


def _unary_external_design(rows, columns, symbol, source_name):
    device = iron.get_current_device()
    core_count = 4
    if rows % core_count:
        raise ValueError(f"row count {rows} must be divisible by {core_count}")
    rows_per_core = rows // core_count
    tensor_type = np.ndarray[(rows, columns), np.dtype[bfloat16]]
    row_type = np.ndarray[(columns,), np.dtype[bfloat16]]
    inputs = [ObjectFifo(row_type, name=f"unary_input_{index}") for index in range(core_count)]
    outputs = [ObjectFifo(row_type, name=f"unary_output_{index}") for index in range(core_count)]
    external = ExternalFunction(
        symbol,
        source_file=str(_SOURCE_ROOT / source_name),
        arg_types=[row_type, row_type, np.int32],
        include_dirs=[config.cxx_header_path()],
    )

    def core(input_fifo, output_fifo, kernel):
        for _ in range_(rows_per_core):
            input_row = input_fifo.acquire(1)
            output_row = output_fifo.acquire(1)
            kernel(input_row, output_row, columns)
            input_fifo.release(1)
            output_fifo.release(1)

    workers = [
        Worker(core, [inputs[index].cons(), outputs[index].prod(), external])
        for index in range(core_count)
    ]
    taps = TensorTiler2D.simple_tiler((rows, columns), (rows_per_core, columns))

    def sequence(a, result, input_producers, output_consumers):
        for index in range(core_count):
            input_producers[index].fill(a, taps[index])
        for index in range(core_count):
            output_consumers[index].drain(result, taps[index], wait=True)

    runtime = Runtime(
        sequence,
        [
            tensor_type,
            tensor_type,
            [fifo.prod() for fifo in inputs],
            [fifo.cons() for fifo in outputs],
        ],
    )
    return Program(device, runtime, workers=workers).resolve_program()


@iron.jit
def rms_norm(
    a_in: In,
    weight_in: In,
    b_out: Out,
    *,
    rows: CompileTime[int],
    columns: CompileTime[int],
):
    return _external_design(
        rows, columns, "qwen_rms_norm_bf16", "amd_phoenix_rms_norm.cc"
    )


@iron.jit
def rope(
    a_in: In,
    lut_in: In,
    b_out: Out,
    *,
    rows: CompileTime[int],
    columns: CompileTime[int],
):
    return _external_design(rows, columns, "qwen_rope_bf16", "amd_phoenix_rope.cc")


@iron.jit
def softmax_rows(
    a_in: In,
    b_out: Out,
    *,
    rows: CompileTime[int],
    columns: CompileTime[int],
):
    return _unary_external_design(
        rows, columns, "qwen_softmax_bf16", "amd_phoenix_softmax.cc"
    )
