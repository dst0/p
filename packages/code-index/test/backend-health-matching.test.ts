import { describe, expect, it } from "vitest";
import { matchesConfiguredEmbeddingBackend } from "../src/embed/backend-health.ts";

describe("backend health matching and hardware device normalization", () => {
  it("handles auto and undefined configured devices", () => {
    expect(matchesConfiguredEmbeddingBackend(undefined, {})).toBe(true);
    expect(matchesConfiguredEmbeddingBackend("auto", {})).toBe(true);
    expect(matchesConfiguredEmbeddingBackend("mps", { fallbackOccurred: true })).toBe(false);
  });

  it("normalizes diverse backend names and npu aliases", () => {
    expect(matchesConfiguredEmbeddingBackend("mps", { requestedBackend: "apple-mps", selectedBackend: "mps" })).toBe(
      true,
    );
    expect(
      matchesConfiguredEmbeddingBackend("cuda", { requestedBackend: "nvidia-cuda", selectedBackend: "cuda" }),
    ).toBe(true);
    expect(matchesConfiguredEmbeddingBackend("rocm", { requestedBackend: "amd-rocm", selectedBackend: "rocm" })).toBe(
      true,
    );
    expect(
      matchesConfiguredEmbeddingBackend("apple-coreml", {
        requestedBackend: "apple-coreai-ane-v1",
        selectedBackend: "apple-coreml",
      }),
    ).toBe(true);
    expect(
      matchesConfiguredEmbeddingBackend("openvino-npu", {
        requestedBackend: "intel-openvino-npu",
        selectedBackend: "openvino-npu",
      }),
    ).toBe(true);
    expect(
      matchesConfiguredEmbeddingBackend("ryzenai", {
        requestedBackend: "amd-ryzenai-npu",
        selectedBackend: "vitisai",
      }),
    ).toBe(true);
    expect(
      matchesConfiguredEmbeddingBackend("npu", {
        requestedBackend: "intel-openvino-npu",
        selectedBackend: "apple-ane",
      }),
    ).toBe(true);
    expect(matchesConfiguredEmbeddingBackend("cpu", { requestedBackend: 123, selectedBackend: null })).toBe(false);
    expect(matchesConfiguredEmbeddingBackend("cpu", { requestedBackend: "   ", selectedBackend: "cpu" })).toBe(false);
  });
});
