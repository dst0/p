import { theme } from "../../theme/theme.ts";

export interface IndexHealth {
  device?: string;
  requestedBackend?: string;
  selectedBackend?: string;
  executionDevice?: string;
  gpuAllowed?: boolean;
  fallbackOccurred?: boolean;
  fallbackReason?: string;
  npuRuntime?: string;
  npuPlacement?: string;
  npuFullyPlaced?: boolean;
  gpuActivity?: boolean;
  performance?: {
    backend?: string;
    vectors?: number;
    seconds?: number;
    vectorsPerSecond?: number;
  };
  resource_plan?: { batch_size?: number };
  runtime?: { warnings?: string[] };
}

export function formatIndexHealth(health: IndexHealth): string {
  const backendLabel = (value: string): string => {
    const normalized = value.toLowerCase();
    if (normalized === "mps" || normalized === "apple-mps") return "GPU (MPS)";
    if (normalized === "apple-ane") return "NPU (Apple Neural Engine)";
    if (normalized === "apple-coreai-ane") {
      return "NPU (Apple Neural Engine via Core AI)";
    }
    if (normalized === "apple-coreai-ane-windowed") {
      return "NPU (Core AI ANE, windowed long inputs)";
    }
    if (normalized === "apple-coreai-ane+coreml") {
      return "NPU (Core AI ANE + CoreML EP hybrid)";
    }
    if (normalized === "apple-coreml") return "NPU (CoreML EP, hybrid ANE + CPU)";
    if (normalized === "npu") return "NPU";
    return value;
  };
  let text = "";
  if (health.requestedBackend) {
    text += `Requested backend: ${theme.bold(backendLabel(health.requestedBackend))}\n`;
  }
  if (health.selectedBackend) {
    text += `Selected backend: ${theme.bold(backendLabel(health.selectedBackend))}\n`;
  }
  const device = health.executionDevice ?? health.device;
  if (device) text += `Execution device: ${theme.bold(backendLabel(device))}\n`;
  if (health.gpuAllowed !== undefined) {
    const selected = health.selectedBackend?.toLowerCase();
    const disabledReason =
      selected === "cpu"
        ? "CPU backend"
        : selected?.includes("npu") || selected?.startsWith("apple-core")
          ? "NPU selected"
          : "policy";
    const allowed = health.gpuAllowed ? theme.fg("success", "yes") : theme.fg("warning", `no (${disabledReason})`);
    text += `GPU allowed: ${allowed}\n`;
  }
  if (health.fallbackOccurred) {
    text += `Fallback occurred: ${theme.fg("warning", "yes")} (${health.fallbackReason ?? "CPU fallback"})\n`;
  }
  if (health.npuRuntime) text += `NPU runtime: ${theme.bold(health.npuRuntime)}\n`;
  if (health.npuPlacement) {
    const verification = health.npuFullyPlaced ? ", verified" : "";
    const gpu = health.gpuActivity === false ? ", no GPU activity" : "";
    text += `NPU placement: ${theme.bold(`${health.npuPlacement}${verification}${gpu}`)}\n`;
  }
  if (health.resource_plan?.batch_size !== undefined) {
    text += `Current used batch size: ${theme.bold(String(health.resource_plan.batch_size))}\n`;
  }
  const performance = health.performance;
  if (performance?.vectorsPerSecond !== undefined && performance.vectorsPerSecond > 0) {
    const sample =
      performance.vectors !== undefined && performance.seconds !== undefined
        ? ` (${performance.vectors} vectors in ${performance.seconds.toFixed(3)}s on ${backendLabel(performance.backend ?? health.selectedBackend ?? "current backend")})`
        : "";
    text += `Measured performance: ${theme.bold(`${performance.vectorsPerSecond.toFixed(1)} vectors/s`)}${sample}\n`;
  } else {
    text += "Measured performance: waiting for a real multi-vector embedding batch\n";
  }
  if (health.runtime?.warnings?.length) {
    text += `Embedding warnings: ${theme.fg("warning", health.runtime.warnings.join("; "))}\n`;
  }
  return text;
}
