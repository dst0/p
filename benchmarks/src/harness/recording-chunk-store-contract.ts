import type { Writable } from "node:stream";

export interface BenchmarkRecordingChunkStoreOptions {
  maxActiveChunkBytes?: number;
  maxArchiveBytes?: number;
  maxBytes?: number;
  maxStoredBytes?: number;
}

export interface BenchmarkRecordingPaths {
  activePath: string;
  chunkDirectory: string;
  compressedTempPath: string;
  manifestPath: string;
}

export interface BenchmarkRecordingAccounting {
  bytes: number;
  archiveBytes: number;
  archiveLimitBytes: number;
  chunkCount: number;
  sha256: string;
  storageLimitBytes: number;
  storedBytes: number;
}

export interface BenchmarkRecordingChunkStore extends BenchmarkRecordingPaths {
  abort(): Promise<void>;
  accounting(): BenchmarkRecordingAccounting;
  append(value: Uint8Array | string): Promise<void>;
  readonly archiveLimitBytes: number;
  cleanup(): Promise<void>;
  finalize(): Promise<{ bytes: number; sha256: string; storedBytes: number }>;
  readonly limitBytes: number;
  onFailure(handler: (error: Error) => void): () => boolean;
  readonly partial: boolean;
  stream: Writable;
}
