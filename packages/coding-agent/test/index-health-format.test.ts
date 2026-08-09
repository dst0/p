import { beforeAll, describe, expect, it } from "vitest";
import { formatIndexHealth } from "../src/modes/interactive/interactive-mode/interactivemode-methods/index-health-format.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";

describe("index health formatting", () => {
  beforeAll(() => initTheme("dark"));

  it("labels Apple Metal as GPU (MPS) and reports measured throughput", () => {
    const text = formatIndexHealth({
      requestedBackend: "mps",
      selectedBackend: "apple-mps",
      executionDevice: "mps",
      gpuAllowed: true,
      performance: {
        backend: "mps",
        vectors: 1437,
        seconds: 0.8,
        vectorsPerSecond: 1796.25,
      },
      resource_plan: { batch_size: 4 },
    });

    expect(text).toContain("Requested backend: GPU (MPS)");
    expect(text).toContain("Selected backend: GPU (MPS)");
    expect(text).toContain("Execution device: GPU (MPS)");
    expect(text).toContain("Measured performance: 1796.3 vectors/s");
    expect(text).toContain("1437 vectors in 0.800s on GPU (MPS)");
  });

  it("does not mislabel a CPU backend as a GPU-deny policy", () => {
    const text = formatIndexHealth({
      selectedBackend: "cpu",
      executionDevice: "cpu",
      gpuAllowed: false,
    });

    expect(text).toContain("no (CPU backend)");
    expect(text).not.toContain("GPU-deny policy");
  });

  it("distinguishes native Core AI ANE placement from legacy CoreML hybrid execution", () => {
    const native = formatIndexHealth({
      requestedBackend: "apple-ane",
      selectedBackend: "apple-coreai-ane",
      executionDevice: "NPU (Apple Neural Engine via Core AI)",
      gpuAllowed: false,
      npuRuntime: "Core AI",
      npuPlacement: "full ANE",
      npuFullyPlaced: true,
      gpuActivity: false,
    });
    const legacy = formatIndexHealth({
      selectedBackend: "apple-coreml",
      gpuAllowed: false,
      npuRuntime: "ONNX Runtime CoreML EP",
      npuPlacement: "hybrid ANE + CPU",
      npuFullyPlaced: false,
      gpuActivity: false,
    });

    expect(native).toContain("Selected backend: NPU (Apple Neural Engine via Core AI)");
    expect(native).toContain("NPU placement: full ANE, verified, no GPU activity");
    expect(legacy).toContain("Selected backend: NPU (CoreML EP, hybrid ANE + CPU)");
    expect(legacy).toContain("NPU placement: hybrid ANE + CPU, no GPU activity");
  });

  it("reports long Core AI inputs as windowed ANE execution", () => {
    const text = formatIndexHealth({
      selectedBackend: "apple-coreai-ane-windowed",
      executionDevice: "NPU (Apple Neural Engine via Core AI)",
      gpuAllowed: false,
      npuRuntime: "Core AI",
      npuPlacement: "full ANE windowed path",
      npuFullyPlaced: true,
      gpuActivity: false,
    });

    expect(text).toContain("Selected backend: NPU (Core AI ANE, windowed long inputs)");
    expect(text).toContain("NPU placement: full ANE windowed path, verified, no GPU activity");
  });

  it("reports fallback warnings when a performance sample has no timing details", () => {
    const text = formatIndexHealth({
      selectedBackend: "cuda",
      gpuAllowed: false,
      fallbackOccurred: true,
      performance: { vectorsPerSecond: 2 },
      runtime: { warnings: ["memory pressure"] },
    });

    expect(text).toContain("no (policy)");
    expect(text).toContain("Fallback occurred:");
    expect(text).toContain("(CPU fallback)");
    expect(text).toContain("Measured performance: 2.0 vectors/s");
    expect(text).toContain("Embedding warnings:");
    expect(text).toContain("memory pressure");
  });
});
