export type EmbeddingDevice =
  | "auto"
  | "cpu"
  | "cuda"
  | "rocm"
  | "mps"
  | "npu"
  | "apple-ane"
  | "apple-mps"
  | "amd-rocm"
  | "nvidia-cuda"
  | "ryzenai"
  | "vitisai"
  | "amd-phoenix-npu"
  | "amd-ryzenai-npu"
  | "openvino"
  | "openvino-npu"
  | "intel-openvino-cpu"
  | "intel-openvino-npu";

export const DEFAULT_MAX_SEQUENCE_LENGTH = 2048;
export const APPLE_ACCELERATOR_MAX_SEQUENCE_LENGTH = 512;

export function defaultMaxSequenceLength(device: EmbeddingDevice, platform: string): number {
  const appleAccelerator = device === "mps" || device === "apple-mps" || device === "apple-ane";
  const automaticAppleAccelerator = platform === "darwin" && (device === "auto" || device === "npu");
  return appleAccelerator || automaticAppleAccelerator
    ? APPLE_ACCELERATOR_MAX_SEQUENCE_LENGTH
    : DEFAULT_MAX_SEQUENCE_LENGTH;
}

export interface EmbeddingRuntimeSettings {
  embeddingServerUrl: string;
  embeddingModel: string;
  embeddingDimensions: number;
  embeddingPooling: string;
  embeddingNormalization: string;
  embeddingDevice: EmbeddingDevice;
  pythonExecutable: string;
  torchBackend: "auto" | "cpu" | "cuda" | "rocm";
  maxEmbeddingBatchSize: number;
  maxCpuThreads: number;
  maxSequenceLength: number;
  mpsPrecision: "bfloat16" | "float32";
  minSystemMemoryReserveBytes: number;
  minAcceleratorMemoryReserveBytes: number;
  embeddingModelParameterCount?: number;
  openvinoCacheDirectory: string;
  vitisaiCacheDirectory: string;
  vitisaiCacheKey: string;
  vitisaiConfigFile?: string;
  vitisaiLogLevel: string;
  amdIronArtifactDirectory?: string;
  amdIronCacheDirectory?: string;
  amdIronSourceDirectory?: string;
  amdNpuGeneration?: string;
  amdNpuRuntimeVersion?: string;
  ryzenAiArchivePath?: string;
  embeddingTimeoutMs: number;
  embeddingStartupTimeoutMs: number;
}
