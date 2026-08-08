import fs from "node:fs";
import path from "node:path";
import { detectLanguage, discoverFilesWithOptions } from "../../../discover.ts";
import { type FilePreparationPlan, processFilePreparationTasks } from "../../file-preparation.ts";
import {
  executeFilePreparationTask,
  type FilePreparationResult,
  type FilePreparationTask,
  FilePreparationTaskError,
  type ScannedFile,
} from "../../file-preparation-core.ts";
import { CHUNKER_VERSION } from "../../manifest.ts";
import type { RefreshIndexOptions, StoredChunkPayload } from "../../types.ts";
import { CodeRagError } from "../coderagerror.ts";
import { MAX_CHUNKS_PER_FILE, MEBIBYTE, PREPARATION_SPOOL_DISK_RESERVE_BYTES } from "../constants.ts";
import {
  buildRetrievalText,
  chunkPointId,
  fileIdFor,
  hashText,
  isGeneratedPath,
  isTestPath,
  normalizeRepositoryPath,
} from "../helpers.ts";
import type { PreparedFile, RefreshPlan } from "../types.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export function do_preparedFileFromResult(
  self: WorkspaceCodeRagService,
  result: FilePreparationResult,
  generation: string,
): PreparedFile {
  const stableFile = result.file;
  const indexedAt = self.now().toISOString();
  const fileId = fileIdFor(self.repoId, stableFile.path);
  const preparedChunks = result.chunks.map((chunk, ordinal) => {
    const chunkHash = hashText(chunk.text);
    const payload: StoredChunkPayload = {
      repoId: self.repoId,
      fileId,
      path: stableFile.path,
      language: stableFile.language,
      symbolName: chunk.symbol,
      symbolType: chunk.chunkType,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      fileHash: stableFile.hash,
      chunkHash,
      chunkOrdinal: ordinal,
      chunkerVersion: CHUNKER_VERSION,
      indexGeneration: generation,
      isTest: stableFile.isTest,
      isGenerated: stableFile.isGenerated,
      content: chunk.text,
      indexedAt,
    };
    return {
      id: chunkPointId(self.repoId, fileId, stableFile.hash, ordinal, chunkHash),
      retrievalText: buildRetrievalText(
        stableFile.path,
        stableFile.language,
        chunk.symbol,
        chunk.chunkType,
        chunk.text,
        self.settings.maxEncodeCharacters,
      ),
      payload,
    };
  });
  return {
    file: stableFile,
    entry: {
      hash: stableFile.hash,
      size: stableFile.size,
      mtimeMs: stableFile.mtimeMs,
      chunkCount: preparedChunks.length,
      indexedAt,
      language: stableFile.language,
      isTest: stableFile.isTest,
      isGenerated: stableFile.isGenerated,
    },
    chunks: preparedChunks,
  };
}

export function do_preparationTask(
  self: WorkspaceCodeRagService,
  file: Omit<ScannedFile, "hash" | "size" | "mtimeMs">,
  operation: "scan" | "prepare",
): FilePreparationTask {
  return {
    operation,
    absPath: file.absPath,
    path: file.path,
    language: file.language,
    isTest: file.isTest,
    isGenerated: file.isGenerated,
    maxFileBytes: self.settings.maxFileBytes,
    defaultChunkLines: self.settings.defaultChunkLines,
    maxChunkLines: self.settings.maxChunkLines,
    maxChunksPerFile: MAX_CHUNKS_PER_FILE,
  };
}

export function do_preparationLimits(self: WorkspaceCodeRagService): {
  maxWorkers: number;
  workerMemoryBytes: number;
  memoryReserveBytes: number;
} {
  return {
    maxWorkers: self.settings.preparationMaxWorkers,
    workerMemoryBytes: Math.max(
      self.settings.preparationWorkerMemoryBytes,
      self.settings.maxFileBytes * 4 + 32 * MEBIBYTE,
    ),
    memoryReserveBytes: self.settings.preparationMemoryReserveBytes,
  };
}

export function do_recordPreparationPlan(self: WorkspaceCodeRagService, plan: FilePreparationPlan): void {
  if (!self.lastPreparationPlan || plan.workers > self.lastPreparationPlan.workers || plan.fallbackReason) {
    self.lastPreparationPlan = plan;
  }
}

export function do_assertSpoolCapacity(self: WorkspaceCodeRagService, files: ScannedFile[]): void {
  const sourceBytes = files.reduce((total, file) => total + file.size, 0);
  const estimatedSpoolBytes = sourceBytes * 5 + 64 * MEBIBYTE;
  const disk = fs.statfsSync(self.repositoryDirectory);
  const availableBytes = disk.bavail * disk.bsize;
  if (availableBytes - estimatedSpoolBytes < PREPARATION_SPOOL_DISK_RESERVE_BYTES) {
    throw new FilePreparationTaskError(
      "resource",
      `Insufficient disk space for bounded indexing spool: ${availableBytes} bytes available, ` +
        `${estimatedSpoolBytes} bytes estimated, ${PREPARATION_SPOOL_DISK_RESERVE_BYTES} bytes reserved`,
    );
  }
}

export function do_sparseVocabularyTokenLimit(self: WorkspaceCodeRagService): number {
  const plan = self.lastPreparationPlan;
  if (!plan) return self.settings.maxSparseVocabularyTokens;
  const memoryBudget = Math.max(0, plan.availableMemoryBytes - plan.memoryReserveBytes - plan.maxInFlightBytes);
  const memoryBound = Math.max(1, Math.floor(memoryBudget / 256));
  return Math.min(self.settings.maxSparseVocabularyTokens, memoryBound);
}

export async function do_processPreparedFiles(
  self: WorkspaceCodeRagService,
  files: ScannedFile[],
  generation: string,
  signal: AbortSignal,
  onPrepared: (prepared: PreparedFile, index: number) => Promise<void> | void,
): Promise<void> {
  try {
    const plan = await processFilePreparationTasks(
      files.map((file) => self.preparationTask(file, "prepare")),
      self.preparationLimits(),
      signal,
      (result, index) => onPrepared(self.preparedFileFromResult(result, generation), index),
    );
    self.recordPreparationPlan(plan);
  } catch (error) {
    if (error instanceof FilePreparationTaskError && error.kind === "security") {
      throw new CodeRagError("RAG_SECURITY_BLOCK", error.message);
    }
    throw error;
  }
}

export async function do_refreshPreparedFileIfChanged(
  self: WorkspaceCodeRagService,
  prepared: PreparedFile,
  generation: string,
  signal: AbortSignal,
): Promise<PreparedFile> {
  try {
    const current = fs.statSync(prepared.file.absPath);
    if (current.size === prepared.file.size && current.mtimeMs === prepared.file.mtimeMs) return prepared;
  } catch {
    // Let the bounded preparation task provide the actionable read error.
  }
  if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
  try {
    return self.preparedFileFromResult(
      executeFilePreparationTask(self.preparationTask(prepared.file, "prepare")),
      generation,
    );
  } catch (error) {
    if (error instanceof FilePreparationTaskError && error.kind === "security") {
      throw new CodeRagError("RAG_SECURITY_BLOCK", error.message);
    }
    throw error;
  }
}

export async function do_scanWorkspace(
  self: WorkspaceCodeRagService,
  signal: AbortSignal,
  onProgress: RefreshIndexOptions["onProgress"],
): Promise<ScannedFile[]> {
  const files = discoverFilesWithOptions(self.workspaceRoot, { maxFileSize: self.settings.maxFileBytes });
  const tasks = files.map((absPath) => {
    const relativePath = normalizeRepositoryPath(path.relative(self.workspaceRoot, absPath));
    return self.preparationTask(
      {
        absPath,
        path: relativePath,
        language: detectLanguage(absPath),
        isTest: isTestPath(relativePath),
        isGenerated: isGeneratedPath(relativePath),
      },
      "scan",
    );
  });
  const scanned: ScannedFile[] = [];
  try {
    const plan = await processFilePreparationTasks(tasks, self.preparationLimits(), signal, (result, index) => {
      scanned.push(result.file);
      self.reportProgress(onProgress, "scanning", (5 * (index + 1)) / Math.max(files.length, 1), {
        processedFiles: index + 1,
        totalFiles: files.length,
      });
    });
    self.recordPreparationPlan(plan);
    return scanned;
  } catch (error) {
    if (error instanceof FilePreparationTaskError && error.kind === "security") {
      throw new CodeRagError("RAG_SECURITY_BLOCK", error.message);
    }
    throw error;
  }
}

export function do_createRefreshPlan(self: WorkspaceCodeRagService, scanned: ScannedFile[]): RefreshPlan {
  const previous = self.manifest?.files ?? {};
  const currentPaths = new Set(scanned.map((file) => file.path));
  const added: ScannedFile[] = [];
  const changed: ScannedFile[] = [];
  const unchanged: ScannedFile[] = [];
  for (const file of scanned) {
    const prior = previous[file.path];
    if (!prior) added.push(file);
    else if (prior.hash !== file.hash) changed.push(file);
    else unchanged.push(file);
  }
  const deleted = Object.entries(previous)
    .filter(([filePath]) => !currentPaths.has(filePath))
    .map(([filePath, entry]) => ({ path: filePath, entry }));
  return { added, changed, deleted, unchanged };
}
