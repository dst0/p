import { createHash } from "node:crypto";
import type { WriteStream } from "node:fs";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  fsyncSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  brotliCompressSync,
  brotliDecompressSync,
  createBrotliCompress,
  createBrotliDecompress,
  constants as zlibConstants,
} from "node:zlib";

import { BenchmarkOutputOverflowError } from "./output-overflow-error.ts";

const BROTLI_PARAMS = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};
const CHUNK_NAME = /^chunk-(\d{12})\.jsonl\.(br|raw)$/u;

export interface RecordingChunkAccounting {
  chunkDirectory: string;
  activePath: string;
  sha256: string;
  bytes: number;
}

export interface RecordingArchiveLimit {
  limitBytes: number;
  maxBytes: number;
  overflowBaseBytes: number;
}

interface StreamDigest {
  bytes: number;
  sha256: string;
}

function fsyncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function digestForStream(source: Readable, transform: Transform): Promise<StreamDigest> {
  const hash = createHash("sha256");
  let bytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback();
    },
  });
  return pipeline(source, transform, sink).then(() => ({ bytes, sha256: hash.digest("hex") }));
}

function chunkPaths(chunkDirectory: string): string[] {
  const selected = new Map<string, string>();
  for (const name of readdirSync(chunkDirectory)) {
    const match = CHUNK_NAME.exec(name);
    if (!match) continue;
    const [, index, type] = match;
    if (type === "br" || !selected.has(index)) selected.set(index, join(chunkDirectory, name));
  }
  return [...selected.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, path]) => path);
}

function privateWriteStream(path: string): WriteStream {
  const descriptor = openSync(path, "wx", 0o600);
  return createWriteStream(path, { autoClose: true, fd: descriptor });
}

export function existingBenchmarkArchiveFileBytes(path: string): number {
  const descriptor = lstatSync(path, { throwIfNoEntry: false });
  if (!descriptor) return 0;
  if (!descriptor.isFile()) throw new Error("Benchmark recording destination must be a regular file");
  return descriptor.size;
}

export function createVerifiedBrotliChunk(rawPath: string): {
  bytes: number;
  encoded: Buffer;
  sha256: string;
  storedBytes: number;
} {
  const raw = readFileSync(rawPath);
  const encoded = brotliCompressSync(raw, { params: BROTLI_PARAMS });
  if (!raw.equals(brotliDecompressSync(encoded))) {
    throw new Error("Compressed benchmark recording chunk failed exact decode verification");
  }
  return {
    bytes: raw.length,
    encoded,
    sha256: createHash("sha256").update(raw).digest("hex"),
    storedBytes: encoded.length,
  };
}

export function writeVerifiedBrotliChunk(encoded: Buffer, tempPath: string): void {
  let created = false;
  try {
    writeFileSync(tempPath, encoded, { flag: "wx", mode: 0o600 });
    created = true;
    fsyncPath(tempPath);
  } catch (error) {
    if (created) rmSync(tempPath, { force: true });
    throw error;
  }
}

export function publishVerifiedBrotliChunk(tempPath: string, compressedPath: string): void {
  renameSync(tempPath, compressedPath);
  fsyncPath(dirname(compressedPath));
}

export async function* replayBenchmarkRecordingChunks(
  chunkDirectory: string,
  activePath?: string,
): AsyncGenerator<Buffer> {
  for (const path of chunkPaths(chunkDirectory)) {
    const source = path.endsWith(".br")
      ? createReadStream(path).pipe(createBrotliDecompress())
      : createReadStream(path);
    for await (const chunk of source) yield chunk as Buffer;
  }
  if (activePath && statSync(activePath, { throwIfNoEntry: false })) {
    for await (const chunk of createReadStream(activePath)) yield chunk as Buffer;
  }
}

function createBoundedArchiveOutput(options: RecordingArchiveLimit): Transform {
  let bytes = 0;
  return new Transform({
    transform(chunk, _encoding, callback) {
      const observedBytes = bytes + chunk.length;
      if (observedBytes > options.maxBytes) {
        callback(
          new BenchmarkOutputOverflowError(
            "recording archive",
            options.limitBytes,
            options.overflowBaseBytes + observedBytes,
          ),
        );
        return;
      }
      bytes = observedBytes;
      callback(null, chunk);
    },
  });
}

export async function recomposeBenchmarkRecordingChunks(
  { chunkDirectory, activePath, sha256, bytes }: RecordingChunkAccounting,
  finalPath: string,
  archiveLimit: RecordingArchiveLimit,
): Promise<StreamDigest & { storedBytes: number }> {
  const tempPath = `${finalPath}.tmp`;
  let created = false;
  try {
    const destination = privateWriteStream(tempPath);
    created = true;
    await pipeline(
      Readable.from(replayBenchmarkRecordingChunks(chunkDirectory, activePath)),
      createBrotliCompress({ params: BROTLI_PARAMS }),
      createBoundedArchiveOutput(archiveLimit),
      destination,
    );
    const decoded = await digestForStream(createReadStream(tempPath), createBrotliDecompress());
    if (decoded.bytes !== bytes || decoded.sha256 !== sha256) {
      throw new Error("Recomposed benchmark recording failed exact decode verification");
    }
    fsyncPath(tempPath);
    const storedBytes = statSync(tempPath).size;
    fsyncPath(dirname(finalPath));
    renameSync(tempPath, finalPath);
    fsyncPath(dirname(finalPath));
    return { bytes: decoded.bytes, sha256: decoded.sha256, storedBytes };
  } catch (error) {
    if (created) rmSync(tempPath, { force: true });
    throw error;
  }
}
