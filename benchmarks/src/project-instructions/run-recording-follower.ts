import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { brotliDecompressSync, createBrotliDecompress } from "node:zlib";

const READ_BUFFER_BYTES = 1024 * 1024;
const CHUNK_NAME = /^chunk-(\d{12})\.jsonl\.br$/;

type RecordingManifest = { schemaVersion: 1; bytes: number; sha256: string; manifestBytes: number };
type RecordingCapture = {
  format?: string;
  archiveBytes?: number;
  archiveLimitBytes?: number;
  partial?: boolean;
  bytes?: number;
  limitBytes?: number;
  storageBytes?: number;
  storageLimitBytes?: number;
};
type FollowerOptions = {
  chunkDirectory?: string;
  activeRecordingPath?: string;
  finalRecordingPath?: string;
  manifestPath?: string;
  processLine(line: string): void;
  resetSemanticState(): void;
  testHooks?: { afterActiveOpen?: () => void };
};
type FollowerFinalizeOptions = { captureMetadataValid?: boolean; recordingCapture?: RecordingCapture };
type RecordingChunk = { index: number; path: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): unknown {
  return isRecord(error) ? error.code : undefined;
}

function nonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validManifest(value: unknown): value is Omit<RecordingManifest, "manifestBytes"> {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).sort().join("\0") === "bytes\0schemaVersion\0sha256" &&
    value.schemaVersion === 1 &&
    nonnegativeSafeInteger(value.bytes) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

function validCapture(options: FollowerFinalizeOptions, manifest: RecordingManifest): boolean {
  const capture = options.recordingCapture;
  return (
    options.captureMetadataValid === true &&
    capture?.format === "chunked-brotli-v1" &&
    nonnegativeSafeInteger(capture.archiveBytes) &&
    positiveSafeInteger(capture.archiveLimitBytes) &&
    capture.archiveBytes <= capture.archiveLimitBytes &&
    capture.partial === false &&
    capture.bytes === manifest.bytes &&
    positiveSafeInteger(capture.limitBytes) &&
    capture.bytes <= capture.limitBytes &&
    nonnegativeSafeInteger(capture.storageBytes) &&
    positiveSafeInteger(capture.storageLimitBytes) &&
    capture.storageBytes <= capture.storageLimitBytes
  );
}

function readManifest(path: string): RecordingManifest | undefined {
  try {
    const contents = readFileSync(path);
    const manifest: unknown = JSON.parse(contents.toString("utf8"));
    return validManifest(manifest) ? { ...manifest, manifestBytes: contents.length } : undefined;
  } catch {
    return undefined;
  }
}

function listChunks(directory: string): RecordingChunk[] {
  try {
    return readdirSync(directory)
      .map((name) => {
        const match = CHUNK_NAME.exec(name);
        const index = match?.[1];
        return index ? { index: Number(index), path: join(directory, name) } : undefined;
      })
      .filter((chunk): chunk is RecordingChunk => chunk !== undefined)
      .sort((left, right) => left.index - right.index);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
}

export function createSemanticRecordingFollower(options: FollowerOptions): {
  observe(): { available: boolean; valid: boolean };
  finalize(finalOptions: FollowerFinalizeOptions): Promise<{ available: boolean; complete: boolean }>;
} {
  const chunkDirectory = options.chunkDirectory;
  const chunked = typeof chunkDirectory === "string";
  const activePath = chunked ? join(chunkDirectory, "active.jsonl.active") : options.activeRecordingPath;
  let decoder = new StringDecoder("utf8");
  let remainder = "";
  let activeOffset = 0;
  let activeHash = createHash("sha256");
  let nextChunkIndex = 0;
  let available = false;
  let invalid = false;

  function processText(text: string, terminal = false): void {
    const lines = `${remainder}${text}`.split("\n");
    remainder = lines.pop() ?? "";
    for (const line of lines) if (line) options.processLine(line);
    if (terminal && remainder) options.processLine(remainder);
    if (terminal) remainder = "";
  }

  function processBytes(buffer: Buffer): void {
    if (buffer.length > 0) processText(decoder.write(buffer));
  }

  function resetParser(): void {
    decoder = new StringDecoder("utf8");
    remainder = "";
  }

  function drainChunks(): void {
    const chunks = listChunks(options.chunkDirectory ?? "");
    for (const chunk of chunks) {
      if (chunk.index < nextChunkIndex) continue;
      if (chunk.index !== nextChunkIndex) {
        invalid = true;
        return;
      }
      let bytes: Buffer;
      try {
        bytes = brotliDecompressSync(readFileSync(chunk.path));
      } catch (error) {
        if (errorCode(error) === "ENOENT") return;
        invalid = true;
        return;
      }
      available = true;
      if (
        bytes.length < activeOffset ||
        (activeOffset > 0 &&
          createHash("sha256").update(bytes.subarray(0, activeOffset)).digest("hex") !==
            activeHash.copy().digest("hex"))
      ) {
        invalid = true;
        return;
      }
      processBytes(bytes.subarray(activeOffset));
      activeOffset = 0;
      activeHash = createHash("sha256");
      nextChunkIndex += 1;
    }
  }

  function readActiveDescriptor(descriptor: number): void {
    const size = fstatSync(descriptor).size;
    if (size < activeOffset) {
      if (chunked) invalid = true;
      else {
        activeOffset = 0;
        activeHash = createHash("sha256");
        resetParser();
      }
      return;
    }
    while (activeOffset < size) {
      const buffer = Buffer.allocUnsafe(Math.min(READ_BUFFER_BYTES, size - activeOffset));
      const bytesRead = readSync(descriptor, buffer, 0, buffer.length, activeOffset);
      if (bytesRead === 0) return;
      const bytes = buffer.subarray(0, bytesRead);
      activeOffset += bytesRead;
      activeHash.update(bytes);
      processBytes(bytes);
    }
  }

  function drainActive(): void {
    if (!activePath) return;
    for (;;) {
      if (chunked) drainChunks();
      if (invalid) return;
      let descriptor: number;
      try {
        descriptor = openSync(activePath, "r");
      } catch (error) {
        if (errorCode(error) === "ENOENT") return;
        throw error;
      }
      available = true;
      try {
        options.testHooks?.afterActiveOpen?.();
        const before = nextChunkIndex;
        if (chunked) drainChunks();
        if (invalid) return;
        if (nextChunkIndex !== before) continue;
        readActiveDescriptor(descriptor);
        return;
      } finally {
        closeSync(descriptor);
      }
    }
  }

  function observe(): { available: boolean; valid: boolean } {
    drainActive();
    return { available, valid: !invalid };
  }

  async function replayFinal(): Promise<{ bytes: number; encodedBytes: number; sha256: string }> {
    if (!options.finalRecordingPath) throw new Error("final recording path is missing");
    const hash = createHash("sha256");
    let bytes = 0;
    options.resetSemanticState();
    resetParser();
    const decompressor = createReadStream(options.finalRecordingPath).pipe(createBrotliDecompress());
    for await (const chunk of decompressor) {
      bytes += chunk.length;
      hash.update(chunk);
      processBytes(chunk);
    }
    processText(decoder.end(), true);
    return { bytes, encodedBytes: statSync(options.finalRecordingPath).size, sha256: hash.digest("hex") };
  }

  function chunksAreContiguous(): boolean {
    if (!options.chunkDirectory || !existsSync(options.chunkDirectory)) return true;
    if (activePath && existsSync(activePath)) return false;
    const chunks = listChunks(options.chunkDirectory);
    return chunks.every((chunk, index) => chunk.index === index);
  }

  async function finalize(finalOptions: FollowerFinalizeOptions): Promise<{ available: boolean; complete: boolean }> {
    observe();
    if (
      (activePath && existsSync(activePath)) ||
      !options.finalRecordingPath ||
      !existsSync(options.finalRecordingPath)
    ) {
      return { available, complete: false };
    }
    available = true;
    let replay: Awaited<ReturnType<typeof replayFinal>>;
    try {
      replay = await replayFinal();
    } catch {
      invalid = true;
      return { available, complete: false };
    }
    if (!options.manifestPath) return { available, complete: !invalid };
    const manifest = readManifest(options.manifestPath);
    const complete =
      !invalid &&
      manifest !== undefined &&
      replay.bytes === manifest.bytes &&
      replay.sha256 === manifest.sha256 &&
      finalOptions.recordingCapture?.archiveBytes === replay.encodedBytes + manifest.manifestBytes &&
      validCapture(finalOptions, manifest) &&
      chunksAreContiguous();
    return { available, complete };
  }

  return { finalize, observe };
}
