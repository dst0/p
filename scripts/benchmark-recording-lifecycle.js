import { DEFAULT_BENCHMARK_OUTPUT_LIMITS } from "./benchmark-output-capture.js";
import { createBenchmarkRecordingChunkStore } from "./benchmark-recording-chunk-store.js";

export { benchmarkRecordingPaths } from "./benchmark-recording-chunk-store.js";

export function createBenchmarkRecording(finalPath, options = {}) {
  const maxBytes = options.maxBytes ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxRawRecordingBytes;
  const maxActiveChunkBytes =
    options.maxActiveChunkBytes ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxActiveRecordingChunkBytes;
  const maxArchiveBytes =
    options.maxArchiveBytes ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxRecordingArchiveBytes;
  const maxStoredBytes =
    options.maxStoredBytes ?? DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxRecordingStorageBytes;
  const store = createBenchmarkRecordingChunkStore(finalPath, {
    maxActiveChunkBytes,
    maxArchiveBytes,
    maxBytes,
    maxStoredBytes,
  });
  const capture = {
    format: "chunked-brotli-v1",
    get archiveBytes() {
      return store.accounting().archiveBytes;
    },
    get archiveLimitBytes() {
      return maxArchiveBytes;
    },
    get bytes() {
      return store.accounting().bytes;
    },
    get limitBytes() {
      return maxBytes;
    },
    get partial() {
      return store.partial;
    },
    get storageBytes() {
      return store.accounting().storedBytes;
    },
    get storageLimitBytes() {
      return maxStoredBytes;
    },
  };

  return {
    abort: store.abort,
    activePath: store.activePath,
    capture,
    chunkDirectory: store.chunkDirectory,
    compressedTempPath: store.compressedTempPath,
    async finalize() {
      await store.finalize();
      return capture;
    },
    get byteLength() {
      return capture.bytes;
    },
    get limitBytes() {
      return maxBytes;
    },
    manifestPath: store.manifestPath,
    onFailure: store.onFailure,
    get partial() {
      return store.partial;
    },
    get storageLimitBytes() {
      return maxStoredBytes;
    },
    get archiveLimitBytes() {
      return maxArchiveBytes;
    },
    stream: store.stream,
  };
}
