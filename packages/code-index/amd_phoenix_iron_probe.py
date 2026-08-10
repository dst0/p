#!/usr/bin/env python3
"""Compile and execute a minimal BF16 kernel on an AMD Phoenix/Hawk Point NPU."""

import argparse
import json

import numpy as np
from ml_dtypes import bfloat16

import aie.iron as iron
from aie.iron import In, Out, kernels
from aie.iron.algorithms import transform_parallel


@iron.jit
def phoenix_relu_probe(a_in: In, b_out: Out):
    tensor_type = np.ndarray[(8192,), np.dtype[bfloat16]]
    return transform_parallel(
        kernels.relu(tile_size=1024),
        tensor_type,
        tile_size=1024,
        num_channels=2,
        pass_size_to_kernel=False,
    )


def run_probe() -> dict[str, object]:
    input_values = np.linspace(-4.0, 4.0, 8192, dtype=np.float32).astype(bfloat16)
    input_tensor = iron.tensor(input_values, dtype=bfloat16, device="npu")
    output_tensor = iron.zeros_like(input_tensor)
    phoenix_relu_probe(input_tensor, output_tensor)
    actual = output_tensor.numpy().astype(np.float32)
    expected = np.maximum(input_values.astype(np.float32), 0.0)
    maximum_error = float(np.max(np.abs(actual - expected)))
    if maximum_error > 0.03125:
        raise RuntimeError(f"Phoenix IRON probe mismatch: maximum error {maximum_error}")
    return {
        "deviceGeneration": "npu1",
        "dispatchVerified": True,
        "kernel": "bf16-relu-8192",
        "maximumError": maximum_error,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = run_probe()
    print(json.dumps(result, sort_keys=True) if args.json else "AMD Phoenix IRON probe passed")


if __name__ == "__main__":
    main()
