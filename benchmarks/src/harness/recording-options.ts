export interface BenchmarkRecordingOptionsInput {
  outputLimits?: {
    maxActiveRecordingChunkBytes?: number;
    maxRecordingArchiveBytes?: number;
    maxRawRecordingBytes?: number;
    maxRecordingStorageBytes?: number;
  };
}

export function benchmarkRecordingOptions(options: BenchmarkRecordingOptionsInput = {}) {
  return {
    maxActiveChunkBytes: options.outputLimits?.maxActiveRecordingChunkBytes,
    maxArchiveBytes: options.outputLimits?.maxRecordingArchiveBytes,
    maxBytes: options.outputLimits?.maxRawRecordingBytes,
    maxStoredBytes: options.outputLimits?.maxRecordingStorageBytes,
  };
}
