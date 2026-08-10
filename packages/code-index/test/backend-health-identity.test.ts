import { describe, expect, it } from "vitest";
import { matchesConfiguredEmbeddingBackend } from "../src/embed/backend-health.ts";

describe("embedding backend health identity", () => {
  it.each([
    ["mps", "mps", "mps"],
    ["mps", "apple-mps", "apple-mps"],
    ["cuda", "nvidia-cuda", "nvidia-cuda"],
    ["rocm", "amd-rocm", "amd-rocm"],
    ["apple-ane", "apple-ane", "apple-coreai-ane"],
    ["apple-ane", "apple-ane", "apple-coreai-ane-windowed"],
    ["apple-ane", "apple-ane", "apple-coreml"],
    ["intel-openvino-npu", "intel-openvino-npu", "openvino-npu"],
    ["npu", "npu", "amd-phoenix-npu"],
  ])("accepts configured %s as requested %s and selected %s", (configured, requested, selected) => {
    expect(
      matchesConfiguredEmbeddingBackend(configured, {
        requestedBackend: requested,
        selectedBackend: selected,
        fallbackOccurred: false,
      }),
    ).toBe(true);
  });

  it("rejects fallback and a different execution family", () => {
    expect(
      matchesConfiguredEmbeddingBackend("apple-ane", {
        requestedBackend: "apple-ane",
        selectedBackend: "cpu",
        fallbackOccurred: true,
      }),
    ).toBe(false);
    expect(
      matchesConfiguredEmbeddingBackend("mps", {
        requestedBackend: "mps",
        selectedBackend: "cpu",
        fallbackOccurred: false,
      }),
    ).toBe(false);
  });
});
