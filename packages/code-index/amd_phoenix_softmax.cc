// Copyright (C) 2024-2026 Advanced Micro Devices, Inc.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception

#include <aie_api/aie.hpp>
#include <stdint.h>

extern "C" void qwen_softmax_bf16(bfloat16 *restrict input,
                                    bfloat16 *restrict output,
                                    int32_t size) {
  event0();
  float maximum = static_cast<float>(input[0]);
  for (int32_t index = 1; index < size; ++index) {
    float value = static_cast<float>(input[index]);
    if (value > maximum) maximum = value;
  }
  float sum = 0.0f;
  for (int32_t index = 0; index < size; ++index) {
    float value = static_cast<float>(input[index]) - maximum;
    if (value < -80.0f) {
      output[index] = static_cast<bfloat16>(0.0f);
      continue;
    }
    float scaled = value * 1.4426950408889634f;
    int32_t exponent = static_cast<int32_t>(scaled);
    if (scaled < static_cast<float>(exponent)) --exponent;
    float fraction = scaled - static_cast<float>(exponent);
    union {
      uint32_t bits;
      float value;
    } power = {static_cast<uint32_t>(exponent + 127) << 23};
    float fraction_power =
        1.0f + fraction *
                   (0.6931471805599453f +
                    fraction *
                        (0.2402265069591007f +
                         fraction *
                             (0.0555041086648216f +
                              fraction * 0.0096181291076285f)));
    float result = power.value * fraction_power;
    output[index] = static_cast<bfloat16>(result);
    sum += result;
  }
  float inverse_sum = 1.0f / (sum + 1e-7f);
  for (int32_t index = 0; index < size; ++index) {
    output[index] = static_cast<bfloat16>(
        static_cast<float>(output[index]) * inverse_sum);
  }
  event1();
}
