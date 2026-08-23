import { createHash } from "node:crypto";
import {
  closeSync,
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Writable } from "node:stream";
import { finished } from "node:stream/promises";

import { BenchmarkOutputOverflowError } from "./benchmark-output-overflow-error.js";
import {
  createVerifiedBrotliChunk,
  existingBenchmarkArchiveFileBytes,
  publishVerifiedBrotliChunk,
  recomposeBenchmarkRecordingChunks,
  replayBenchmarkRecordingChunks,
  writeVerifiedBrotliChunk,
} from "./benchmark-recording-chunk-archive.js";

function fsyncPath(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function writeChunk(stream, chunk) {
  return new Promise((resolve, reject) => {
    stream.write(chunk, (error) => (error ? reject(error) : resolve()));
  });
}

function validateLimit(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  return value;
}

export function benchmarkRecordingPaths(finalPath) {
  const basePath = finalPath.endsWith(".br") ? finalPath.slice(0, -3) : finalPath;
  return {
    activePath: join(`${basePath}.chunks`, "active.jsonl.active"),
    chunkDirectory: `${basePath}.chunks`,
    compressedTempPath: `${finalPath}.tmp`,
    manifestPath: `${basePath}.manifest.json`,
  };
}

function manifestPayload(accounting) {
  return Buffer.from(`${JSON.stringify({ schemaVersion: 1, ...accounting })}\n`);
}

function publishManifest(manifestPath, payload) {
  const tempPath = `${manifestPath}.tmp`;
  let created = false;
  try {
    writeFileSync(tempPath, payload, { flag: "wx", mode: 0o600 });
    created = true;
    fsyncPath(tempPath);
    renameSync(tempPath, manifestPath);
    fsyncPath(dirname(manifestPath));
  } catch (error) {
    if (created) rmSync(tempPath, { force: true });
    throw error;
  }
}

export { recomposeBenchmarkRecordingChunks, replayBenchmarkRecordingChunks };

export function createBenchmarkRecordingChunkStore(finalPath, options = {}) {
  const maxActiveChunkBytes = validateLimit("maxActiveChunkBytes", options.maxActiveChunkBytes ?? 32 * 1024 * 1024);
  const maxBytes = validateLimit("maxBytes", options.maxBytes ?? 512 * 1024 * 1024);
  const maxStoredBytes = validateLimit("maxStoredBytes", options.maxStoredBytes ?? 256 * 1024 * 1024);
  const maxArchiveBytes = validateLimit("maxArchiveBytes", options.maxArchiveBytes ?? 256 * 1024 * 1024);
  const { activePath, chunkDirectory, compressedTempPath, manifestPath } = benchmarkRecordingPaths(finalPath);
  mkdirSync(chunkDirectory, { mode: 0o700 });
  fsyncPath(dirname(chunkDirectory));
  try {
    rmSync(compressedTempPath, { force: true });
    rmSync(`${manifestPath}.tmp`, { force: true });
  } catch (error) {
    rmSync(chunkDirectory, { force: true, recursive: true });
    fsyncPath(dirname(chunkDirectory));
    throw error;
  }
  let activeStream;
  let activeBytes = 0;
  let archiveBytes = 0;
  let bytes = 0;
  let chunks = 0;
  let committedBytes = 0;
  let overflow;
  let failure;
  let sequence = 0;
  let state = "active";
  let queue = Promise.resolve();
  const digest = createHash("sha256");
  const failureHandlers = new Set();

  function notifyFailure(error) {
    if (error instanceof BenchmarkOutputOverflowError) {
      if (overflow) return;
      overflow = error;
    } else if (failure) return;
    else failure = error;
    for (const handler of failureHandlers) handler(error);
  }

  function createActiveStream() {
    const descriptor = openSync(activePath, "wx", 0o600);
    activeStream = createWriteStream(activePath, { autoClose: true, fd: descriptor });
    activeStream.on("error", notifyFailure);
    activeBytes = 0;
  }

  async function closeActiveStream() {
    if (!activeStream.writableEnded) activeStream.end();
    await finished(activeStream);
    fsyncPath(activePath);
  }

  async function rotate() {
    if (activeBytes === 0) return true;
    await closeActiveStream();
    const index = String(sequence++).padStart(12, "0");
    const rawPath = join(chunkDirectory, `chunk-${index}.jsonl.raw`);
    const compressedPath = join(chunkDirectory, `chunk-${index}.jsonl.br`);
    const tempPath = `${compressedPath}.tmp`;
    renameSync(activePath, rawPath);
    fsyncPath(chunkDirectory);
    try {
      const archived = createVerifiedBrotliChunk(rawPath);
      if (committedBytes + activeBytes + archived.storedBytes > maxStoredBytes) return false;
      writeVerifiedBrotliChunk(archived.encoded, tempPath);
      publishVerifiedBrotliChunk(tempPath, compressedPath);
      rmSync(rawPath, { force: true });
      fsyncPath(chunkDirectory);
      committedBytes += archived.storedBytes;
      chunks += 1;
      createActiveStream();
      return true;
    } finally {
      if ((!activeStream || activeStream.writableEnded) && existsSync(rawPath)) renameSync(rawPath, activePath);
    }
  }

  async function appendBuffer(value) {
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
    if (offset < acceptedBytes) notifyFailure(new BenchmarkOutputOverflowError("recording storage", maxStoredBytes, bytes + source.length - offset));
    else if (acceptedBytes < source.length) notifyFailure(new BenchmarkOutputOverflowError("raw recording", maxBytes, bytes + source.length - acceptedBytes));
  }

  function append(value) {
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

  function accounting() {
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

  async function cleanup() {
    if (state === "cleaned" || state === "finalized") return;
    state = "cleaning";
    if (!stream.writableEnded) stream.end();
    await finished(stream).catch(() => undefined);
    await queue;
    if (!activeStream.destroyed && !activeStream.writableEnded) activeStream.end();
    await finished(activeStream).catch(() => undefined);
    rmSync(chunkDirectory, { force: true, recursive: true });
    fsyncPath(dirname(chunkDirectory));
    state = "cleaned";
  }

  async function finalize() {
    if (state !== "active") throw new Error(`Cannot finalize benchmark recording in ${state} state`);
    state = "finalizing";
    try {
      stream.end();
      await finished(stream);
      await queue;
      if (failure) throw failure;
      if (!overflow && !(await rotate())) throw new Error("Benchmark recording storage rotation failed");
      const manifest = manifestPayload({
        bytes,
        sha256: digest.copy().digest("hex"),
      });
      const existingArchiveBytes =
        existingBenchmarkArchiveFileBytes(finalPath) + existingBenchmarkArchiveFileBytes(manifestPath);
      const reservedArchiveBytes = existingArchiveBytes + manifest.length;
      if (reservedArchiveBytes >= maxArchiveBytes) {
        const error = new BenchmarkOutputOverflowError(
          "recording archive",
          maxArchiveBytes,
          reservedArchiveBytes + 1,
        );
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
      publishManifest(manifestPath, manifest);
      archiveBytes = result.storedBytes + manifest.length;
      await closeActiveStream();
      rmSync(chunkDirectory, { force: true, recursive: true });
      fsyncPath(dirname(chunkDirectory));
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
    onFailure(handler) {
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
