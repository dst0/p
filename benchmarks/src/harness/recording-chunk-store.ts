import { createHash } from "node:crypto";
import type { WriteStream } from "node:fs";
import { createWriteStream, existsSync, mkdirSync, openSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";

import { BenchmarkOutputOverflowError } from "./output-overflow-error.ts";
import {
  createVerifiedBrotliChunk,
  existingBenchmarkArchiveFileBytes,
  publishVerifiedBrotliChunk,
  recomposeBenchmarkRecordingChunks,
  replayBenchmarkRecordingChunks,
  writeVerifiedBrotliChunk,
} from "./recording-chunk-archive.ts";
import type {
  BenchmarkRecordingAccounting,
  BenchmarkRecordingChunkStore,
  BenchmarkRecordingChunkStoreOptions,
} from "./recording-chunk-store-contract.ts";
import {
  benchmarkRecordingManifestPayload,
  benchmarkRecordingPaths,
  fsyncRecordingPath,
  publishBenchmarkRecordingManifest,
} from "./recording-manifest.ts";

function writeChunk(stream: WriteStream, chunk: Buffer): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

function validateLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export { benchmarkRecordingPaths } from "./recording-manifest.ts";

export { recomposeBenchmarkRecordingChunks, replayBenchmarkRecordingChunks };

export function createBenchmarkRecordingChunkStore(
  finalPath: string,
  options: BenchmarkRecordingChunkStoreOptions = {},
): BenchmarkRecordingChunkStore {
  const maxActiveChunkBytes = validateLimit("maxActiveChunkBytes", options.maxActiveChunkBytes ?? 32 * 1024 * 1024);
  const maxBytes = validateLimit("maxBytes", options.maxBytes ?? 512 * 1024 * 1024);
  const maxStoredBytes = validateLimit("maxStoredBytes", options.maxStoredBytes ?? 256 * 1024 * 1024);
  const maxArchiveBytes = validateLimit("maxArchiveBytes", options.maxArchiveBytes ?? 256 * 1024 * 1024);
  const { activePath, chunkDirectory, compressedTempPath, manifestPath } = benchmarkRecordingPaths(finalPath);
  mkdirSync(chunkDirectory, { mode: 0o700 });
  fsyncRecordingPath(dirname(chunkDirectory));
  try {
    rmSync(compressedTempPath, { force: true });
    rmSync(`${manifestPath}.tmp`, { force: true });
  } catch (error) {
    rmSync(chunkDirectory, { force: true, recursive: true });
    fsyncRecordingPath(dirname(chunkDirectory));
    throw error;
  }
  let activeStream: WriteStream;
  let activeBytes = 0;
  let archiveBytes = 0;
  let bytes = 0;
  let chunks = 0;
  let committedBytes = 0;
  let overflow: BenchmarkOutputOverflowError | undefined;
  let failure: Error | undefined;
  let sequence = 0;
  let state: "active" | "finalizing" | "cleaning" | "cleaned" | "finalized" | "failed" = "active";
  let queue: Promise<void> = Promise.resolve();
  const digest = createHash("sha256");
  const failureHandlers = new Set<(error: Error) => void>();

  function notifyFailure(error: unknown): void {
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (normalized instanceof BenchmarkOutputOverflowError) {
      if (overflow) return;
      overflow = normalized;
    } else if (failure) return;
    else failure = normalized;
    for (const handler of failureHandlers) handler(normalized);
  }

  function createActiveStream(): void {
    const descriptor = openSync(activePath, "wx", 0o600);
    activeStream = createWriteStream(activePath, { autoClose: true, fd: descriptor });
    activeStream.on("error", notifyFailure);
    activeBytes = 0;
  }

  async function closeActiveStream(): Promise<void> {
    if (!activeStream.writableEnded) activeStream.end();
    await finished(activeStream);
    fsyncRecordingPath(activePath);
  }

  async function rotate(): Promise<boolean> {
    if (activeBytes === 0) return true;
    await closeActiveStream();
    const index = String(sequence++).padStart(12, "0");
    const rawPath = join(chunkDirectory, `chunk-${index}.jsonl.raw`);
    const compressedPath = join(chunkDirectory, `chunk-${index}.jsonl.br`);
    const tempPath = `${compressedPath}.tmp`;
    renameSync(activePath, rawPath);
    fsyncRecordingPath(chunkDirectory);
    try {
      const archived = createVerifiedBrotliChunk(rawPath);
      if (committedBytes + activeBytes + archived.storedBytes > maxStoredBytes) return false;
      writeVerifiedBrotliChunk(archived.encoded, tempPath);
      publishVerifiedBrotliChunk(tempPath, compressedPath);
      rmSync(rawPath, { force: true });
      fsyncRecordingPath(chunkDirectory);
      committedBytes += archived.storedBytes;
      chunks += 1;
      createActiveStream();
      return true;
    } finally {
      if ((!activeStream || activeStream.writableEnded) && existsSync(rawPath)) renameSync(rawPath, activePath);
    }
  }

  async function appendBuffer(value: Uint8Array | string): Promise<void> {
    if (state !== "active" && state !== "finalizing") {
      throw new Error(`Cannot append benchmark recording in ${state} state`);
    }
    if (overflow) return;
    const source = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const acceptedBytes = Math.min(source.length, maxBytes - bytes);
    let offset = 0;
    while (offset < acceptedBytes) {
      if (activeBytes === maxActiveChunkBytes && !(await rotate())) break;
      const physicalCapacity = maxStoredBytes - committedBytes - activeBytes;
      if (physicalCapacity === 0) {
        if (activeBytes === 0 || !(await rotate())) break;
        continue;
      }
      const length = Math.min(maxActiveChunkBytes - activeBytes, physicalCapacity, acceptedBytes - offset);
      const next = source.subarray(offset, offset + length);
      await writeChunk(activeStream, next);
      digest.update(next);
      bytes += next.length;
      activeBytes += next.length;
      offset += next.length;
    }
    if (offset < acceptedBytes)
      notifyFailure(
        new BenchmarkOutputOverflowError("recording storage", maxStoredBytes, bytes + source.length - offset),
      );
    else if (acceptedBytes < source.length)
      notifyFailure(new BenchmarkOutputOverflowError("raw recording", maxBytes, bytes + source.length - acceptedBytes));
  }

  function append(value: Uint8Array | string): Promise<void> {
    const operation = queue.then(() => {
      if (failure) throw failure;
      return appendBuffer(value);
    });
    queue = operation.catch((error) => notifyFailure(error));
    return operation;
  }

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      append(chunk).then(() => callback(), callback);
    },
  });
  stream.on("error", notifyFailure);

  function accounting(): BenchmarkRecordingAccounting {
    return {
      bytes,
      archiveBytes,
      archiveLimitBytes: maxArchiveBytes,
      chunkCount: chunks,
      sha256: digest.copy().digest("hex"),
      storageLimitBytes: maxStoredBytes,
      storedBytes: committedBytes + activeBytes,
    };
  }

  async function cleanup(): Promise<void> {
    if (state === "cleaned" || state === "finalized") return;
    state = "cleaning";
    if (!stream.writableEnded) stream.end();
    await finished(stream).catch(() => undefined);
    await queue;
    if (!activeStream.destroyed && !activeStream.writableEnded) activeStream.end();
    await finished(activeStream).catch(() => undefined);
    rmSync(chunkDirectory, { force: true, recursive: true });
    fsyncRecordingPath(dirname(chunkDirectory));
    state = "cleaned";
  }

  async function finalize(): Promise<{ bytes: number; sha256: string; storedBytes: number }> {
    if (state !== "active") throw new Error(`Cannot finalize benchmark recording in ${state} state`);
    state = "finalizing";
    try {
      stream.end();
      await finished(stream);
      await queue;
      if (failure) throw failure;
      if (!overflow && !(await rotate())) throw new Error("Benchmark recording storage rotation failed");
      const manifest = benchmarkRecordingManifestPayload({
        bytes,
        sha256: digest.copy().digest("hex"),
      });
      const existingArchiveBytes =
        existingBenchmarkArchiveFileBytes(finalPath) + existingBenchmarkArchiveFileBytes(manifestPath);
      const reservedArchiveBytes = existingArchiveBytes + manifest.length;
      if (reservedArchiveBytes >= maxArchiveBytes) {
        const error = new BenchmarkOutputOverflowError("recording archive", maxArchiveBytes, reservedArchiveBytes + 1);
        notifyFailure(error);
        throw error;
      }
      const result = await recomposeBenchmarkRecordingChunks(
        { ...accounting(), activePath, chunkDirectory },
        finalPath,
        {
          limitBytes: maxArchiveBytes,
          maxBytes: maxArchiveBytes - reservedArchiveBytes,
          overflowBaseBytes: reservedArchiveBytes,
        },
      );
      publishBenchmarkRecordingManifest(manifestPath, manifest);
      archiveBytes = result.storedBytes + manifest.length;
      await closeActiveStream();
      rmSync(chunkDirectory, { force: true, recursive: true });
      fsyncRecordingPath(dirname(chunkDirectory));
      state = "finalized";
      return result;
    } catch (error) {
      notifyFailure(error);
      state = "failed";
      await cleanup();
      throw error;
    }
  }

  createActiveStream();
  return {
    abort: cleanup,
    accounting,
    activePath,
    append,
    get archiveLimitBytes() {
      return maxArchiveBytes;
    },
    chunkDirectory,
    cleanup,
    compressedTempPath,
    finalize,
    get limitBytes() {
      return maxBytes;
    },
    manifestPath,
    onFailure(handler: (error: Error) => void) {
      if (failure) handler(failure);
      else if (overflow) handler(overflow);
      failureHandlers.add(handler);
      return () => failureHandlers.delete(handler);
    },
    get partial() {
      return overflow !== undefined;
    },
    stream,
  };
}
