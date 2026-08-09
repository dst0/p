// Copyright (C) 2025-2026 Advanced Micro Devices, Inc.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

#include <aie_api/aie.hpp>
#include <stdint.h>

template <typename T, int N>
void qwen_rope(const T *restrict input, const T *restrict lut,
               T *restrict output, int32_t dims) {
  event0();
  const int32_t half = dims / 2;
  for (int offset = 0; offset < half; offset += N) {
    auto first = ::aie::load_v<N>(input + offset);
    auto second = ::aie::load_v<N>(input + half + offset);
    auto cosine = ::aie::load_v<N>(lut + offset);
    auto sine = ::aie::load_v<N>(lut + half + offset);
    auto first_cosine = ::aie::mul(first, cosine).template to_vector<T>();
    auto second_sine = ::aie::mul(second, sine).template to_vector<T>();
    auto second_cosine = ::aie::mul(second, cosine).template to_vector<T>();
    auto first_sine = ::aie::mul(first, sine).template to_vector<T>();
    ::aie::store_v(output + offset, ::aie::sub(first_cosine, second_sine));
    ::aie::store_v(
        output + half + offset, ::aie::add(second_cosine, first_sine));
  }
  event1();
}

extern "C" void qwen_rope_bf16(bfloat16 *input, bfloat16 *lut,
                                 bfloat16 *output, int32_t dims) {
  qwen_rope<bfloat16, 16>(input, lut, output, dims);
}
