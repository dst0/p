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
