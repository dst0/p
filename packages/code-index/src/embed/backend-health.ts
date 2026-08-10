export interface EmbeddingBackendHealthIdentity {
  requestedBackend?: unknown;
  selectedBackend?: unknown;
  fallbackOccurred?: unknown;
}

export function matchesConfiguredEmbeddingBackend(
  configuredDevice: string | undefined,
  health: EmbeddingBackendHealthIdentity,
): boolean {
  if (health.fallbackOccurred === true) return false;
  if (!configuredDevice || configuredDevice === "auto") return true;
  const configured = normalizeBackend(configuredDevice);
  const requested = normalizeBackend(health.requestedBackend);
  const selected = normalizeBackend(health.selectedBackend);
  if (configured === "npu") return isNpuBackend(requested) && isNpuBackend(selected);
  return requested === configured && selected === configured;
}

function normalizeBackend(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const backend = value.trim().toLowerCase();
  if (backend === "mps" || backend === "apple-mps") return "apple-mps";
  if (backend === "cuda" || backend === "nvidia-cuda") return "nvidia-cuda";
  if (backend === "rocm" || backend === "amd-rocm") return "amd-rocm";
  if (backend === "apple-coreml" || backend.startsWith("apple-coreai-ane")) return "apple-ane";
  if (backend === "openvino-npu") return "intel-openvino-npu";
  if (backend === "ryzenai" || backend === "vitisai") return "amd-ryzenai-npu";
  return backend || undefined;
}

function isNpuBackend(backend: string | undefined): boolean {
  return backend === "npu" || backend?.includes("npu") === true || backend === "apple-ane";
}
