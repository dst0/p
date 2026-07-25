import { createHash } from "node:crypto";
import fs from "node:fs";
import { chunkFile } from "../chunk.ts";
import type { Chunk } from "../types.ts";

export interface ScannedFile {
  absPath: string;
  path: string;
  hash: string;
  size: number;
  mtimeMs: number;
  language: string;
  isTest: boolean;
  isGenerated: boolean;
}

export interface FilePreparationTask {
  operation: "scan" | "prepare";
  absPath: string;
  path: string;
  language: string;
  isTest: boolean;
  isGenerated: boolean;
  maxFileBytes: number;
  defaultChunkLines: number;
  maxChunkLines: number;
  maxChunksPerFile: number;
}

export interface FilePreparationResult {
  file: ScannedFile;
  chunks: Chunk[];
  workerThreadId: number;
}

export type FilePreparationErrorKind = "security" | "unstable" | "io" | "resource";

export class FilePreparationTaskError extends Error {
  readonly kind: FilePreparationErrorKind;

  constructor(kind: FilePreparationErrorKind, message: string) {
    super(message);
    this.name = "FilePreparationTaskError";
    this.kind = kind;
  }
}

function readBoundedStableFile(task: FilePreparationTask): { bytes: Buffer; size: number; mtimeMs: number } {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let file: number | undefined;
    try {
      file = fs.openSync(task.absPath, "r");
      const before = fs.fstatSync(file);
      if (!before.isFile()) {
        throw new FilePreparationTaskError("security", `Indexing target is not a regular file: ${task.path}`);
      }
      if (before.size > task.maxFileBytes) {
        throw new FilePreparationTaskError(
          "security",
          `File exceeds the indexing size limit (${task.maxFileBytes} bytes): ${task.path}`,
        );
      }

      const bytes = Buffer.allocUnsafe(task.maxFileBytes + 1);
      let bytesRead = 0;
      while (bytesRead < bytes.length) {
        const count = fs.readSync(file, bytes, bytesRead, bytes.length - bytesRead, bytesRead);
        if (count === 0) break;
        bytesRead += count;
      }
      const after = fs.fstatSync(file);
      if (bytesRead > task.maxFileBytes || after.size > task.maxFileBytes) {
        throw new FilePreparationTaskError(
          "security",
          `File exceeds the indexing size limit (${task.maxFileBytes} bytes): ${task.path}`,
        );
      }
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytesRead !== after.size) continue;
      return { bytes: bytes.subarray(0, bytesRead), size: after.size, mtimeMs: after.mtimeMs };
    } catch (error) {
      if (error instanceof FilePreparationTaskError) throw error;
      if (attempt === 2) {
        const message = error instanceof Error ? error.message : String(error);
        throw new FilePreparationTaskError("io", `Failed to read ${task.path}: ${message}`);
      }
    } finally {
      if (file !== undefined) fs.closeSync(file);
    }
  }
  throw new FilePreparationTaskError("unstable", `File kept changing while indexing: ${task.path}`);
}

export function executeFilePreparationTask(task: FilePreparationTask, workerThreadId = 0): FilePreparationResult {
  const stable = readBoundedStableFile(task);
  const content = stable.bytes.toString("utf-8");
  const chunks =
    task.operation === "prepare" ? chunkFile(content, task.language, task.defaultChunkLines, task.maxChunkLines) : [];
  if (chunks.length > task.maxChunksPerFile) {
    throw new FilePreparationTaskError("security", `File produced too many chunks: ${task.path}`);
  }
  return {
    file: {
      absPath: task.absPath,
      path: task.path,
      hash: createHash("sha256").update(stable.bytes).digest("hex"),
      size: stable.size,
      mtimeMs: stable.mtimeMs,
      language: task.language,
      isTest: task.isTest,
      isGenerated: task.isGenerated,
    },
    chunks,
    workerThreadId,
  };
}
