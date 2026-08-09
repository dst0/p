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
});
