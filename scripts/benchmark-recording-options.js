export function benchmarkRecordingOptions(options = {}) {
  return {
    maxActiveChunkBytes: options.outputLimits?.maxActiveRecordingChunkBytes,
    maxArchiveBytes: options.outputLimits?.maxRecordingArchiveBytes,
    maxBytes: options.outputLimits?.maxRawRecordingBytes,
    maxStoredBytes: options.outputLimits?.maxRecordingStorageBytes,
  };
}
