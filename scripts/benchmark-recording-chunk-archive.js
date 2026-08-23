import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  createWriteStream,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  constants as zlibConstants,
  createBrotliCompress,
  createBrotliDecompress,
  brotliCompressSync,
  brotliDecompressSync,
} from "node:zlib";

import { BenchmarkOutputOverflowError } from "./benchmark-output-overflow-error.js";

const BROTLI_PARAMS = {
  [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
  [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
};
const CHUNK_NAME = /^chunk-(\d{12})\.jsonl\.(br|raw)$/u;

function fsyncPath(path) {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function digestForStream(...streams) {
  const hash = createHash("sha256");
  let bytes = 0;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      hash.update(chunk);
      bytes += chunk.length;
      callback();
    },
  });
  return pipeline(...streams, sink).then(() => ({ bytes, sha256: hash.digest("hex") }));
}

function chunkPaths(chunkDirectory) {
  const selected = new Map();
  for (const name of readdirSync(chunkDirectory)) {
    const match = CHUNK_NAME.exec(name);
    if (!match) continue;
    const [, index, type] = match;
    if (type === "br" || !selected.has(index)) selected.set(index, join(chunkDirectory, name));
  }
  return [...selected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, path]) => path);
}

function privateWriteStream(path) {
  const descriptor = openSync(path, "wx", 0o600);
  return createWriteStream(path, { autoClose: true, fd: descriptor });
}

export function existingBenchmarkArchiveFileBytes(path) {
  const descriptor = lstatSync(path, { throwIfNoEntry: false });
  if (!descriptor) return 0;
  if (!descriptor.isFile()) throw new Error("Benchmark recording destination must be a regular file");
  return descriptor.size;
}

export function createVerifiedBrotliChunk(rawPath) {
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

export function writeVerifiedBrotliChunk(encoded, tempPath) {
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

export function publishVerifiedBrotliChunk(tempPath, compressedPath) {
  renameSync(tempPath, compressedPath);
  fsyncPath(dirname(compressedPath));
}

export async function* replayBenchmarkRecordingChunks(chunkDirectory, activePath) {
  for (const path of chunkPaths(chunkDirectory)) {
    const source = path.endsWith(".br") ? createReadStream(path).pipe(createBrotliDecompress()) : createReadStream(path);
    for await (const chunk of source) yield chunk;
  }
  if (activePath && statSync(activePath, { throwIfNoEntry: false })) {
    for await (const chunk of createReadStream(activePath)) yield chunk;
  }
}

function createBoundedArchiveOutput(options) {
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

export async function recomposeBenchmarkRecordingChunks({ chunkDirectory, activePath, sha256, bytes }, finalPath, archiveLimit) {
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
