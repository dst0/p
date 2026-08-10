// Copyright (C) 2025-2026 Advanced Micro Devices, Inc.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

#include <aie_api/aie.hpp>
#include <stdint.h>

template <typename T, int N>
void qwen_rms_norm(const T *restrict input, const T *restrict weight,
                   T *restrict output, int32_t cols) {
  event0();
  ::aie::vector<float, N> partial = ::aie::zeros<float, N>();
  for (int offset = 0; offset < cols; offset += N) {
    ::aie::vector<T, N> values = ::aie::load_v<N>(input + offset);
    auto square_accumulator = ::aie::mul_square(values);
    auto squares = square_accumulator.template to_vector<float>();
    partial = ::aie::add(partial, squares);
  }
  float mean_square = ::aie::reduce_add(partial) / cols + 1e-6f;
  union {
    float value;
    uint32_t bits;
  } estimate = {mean_square};
  estimate.bits = 0x5f375a86U - (estimate.bits >> 1);
  float inverse_rms = estimate.value;
  inverse_rms *= 1.5f - 0.5f * mean_square * inverse_rms * inverse_rms;
  inverse_rms *= 1.5f - 0.5f * mean_square * inverse_rms * inverse_rms;
  const ::aie::vector<T, N> inverse = ::aie::broadcast<T, N>(static_cast<T>(inverse_rms));
  for (int offset = 0; offset < cols; offset += N) {
    ::aie::vector<T, N> values = ::aie::load_v<N>(input + offset);
    ::aie::vector<T, N> gamma = ::aie::load_v<N>(weight + offset);
    auto normalized_accumulator = ::aie::mul(values, inverse);
    auto normalized = normalized_accumulator.template to_vector<T>();
    auto weighted_accumulator = ::aie::mul(normalized, gamma);
    ::aie::store_v(
        output + offset, weighted_accumulator.template to_vector<T>());
  }
  event1();
}

extern "C" void qwen_rms_norm_bf16(bfloat16 *input, bfloat16 *weight,
                                     bfloat16 *output, int32_t cols) {
  qwen_rms_norm<bfloat16, 16>(input, weight, output, cols);
}
