export type EmbeddingDevice =
  | "auto"
  | "cpu"
  | "cuda"
  | "rocm"
  | "mps"
  | "npu"
  | "ryzenai"
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
  embeddingTimeoutMs: number;
  embeddingStartupTimeoutMs: number;
}
