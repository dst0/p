import fs from "node:fs";
import { createInterface } from "node:readline";
import type { BM25Vocabulary } from "../../../bm25.ts";
import { getGitInfo } from "../../../discover.ts";
import { loadWorkspaceCodeRagSettings } from "../../config.ts";
import { writeManifestAtomic } from "../../manifest.ts";
import type {
  IndexingProgress,
  IndexUpdateSummary,
  ManifestFileEntry,
  RefreshIndexOptions,
  StoredVectorPoint,
  VectorPoint,
} from "../../types.ts";
import { CodeRagError } from "../coderagerror.ts";
import { fileIdFor } from "../helpers.ts";
import { ReusableGenerationError } from "../reusablegenerationerror.ts";
import type { PreparedChunk, RefreshPlan } from "../types.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export async function do_performIncrementalRefresh(
  self: WorkspaceCodeRagService,
  plan: RefreshPlan,
  startedAt: number,
  signal: AbortSignal,
  onProgress: RefreshIndexOptions["onProgress"],
): Promise<IndexUpdateSummary> {
  if (!self.manifest) throw new CodeRagError("RAG_NOT_INITIALIZED", "Code RAG index is not initialized");
  const status = await self.vectorStore.collectionStatus(self.manifest.collection);
  if (status.dimensions !== self.settings.embeddingDimensions) {
    throw new CodeRagError("RAG_INCOMPATIBLE_INDEX", "Stored vector dimensions are incompatible");
  }
  const vocabulary = self.loadVocabulary(self.manifest);
  const nextManifest = structuredClone(self.manifest);
  const indexedAt = self.now().toISOString();
  let chunksEmbedded = 0;
  let completedFiles = 0;
  const changedFiles = [...plan.added, ...plan.changed];
  const totalFiles = changedFiles.length + plan.deleted.length;

  await self.processPreparedFiles(changedFiles, nextManifest.generation, signal, async (initialPrepared) => {
    if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
    const prepared = await self.refreshPreparedFileIfChanged(initialPrepared, nextManifest.generation, signal);
    await self.encodeAndUpsert(nextManifest.collection, prepared.chunks, vocabulary, signal, (completed, total) => {
      const currentFileProgress = total === 0 ? 1 : completed / total;
      self.reportProgress(
        onProgress,
        "indexing",
        5 + (94.8 * (completedFiles + currentFileProgress)) / Math.max(totalFiles, 1),
        { processedFiles: completedFiles, totalFiles },
      );
    });
    await self.vectorStore.deleteFileVersions(
      nextManifest.collection,
      self.repoId,
      fileIdFor(self.repoId, prepared.file.path),
      prepared.chunks.length > 0 ? prepared.file.hash : undefined,
    );
    nextManifest.files[prepared.file.path] = prepared.entry;
    chunksEmbedded += prepared.chunks.length;
    completedFiles += 1;
    self.reportProgress(onProgress, "indexing", 5 + (94.8 * completedFiles) / Math.max(totalFiles, 1), {
      processedFiles: completedFiles,
      totalFiles,
    });
  });
  for (const deleted of plan.deleted) {
    if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
    await self.vectorStore.deleteFileVersions(
      nextManifest.collection,
      self.repoId,
      fileIdFor(self.repoId, deleted.path),
    );
    delete nextManifest.files[deleted.path];
    completedFiles += 1;
    self.reportProgress(onProgress, "indexing", 5 + (94.8 * completedFiles) / Math.max(totalFiles, 1), {
      processedFiles: completedFiles,
      totalFiles,
    });
  }
  for (const file of plan.unchanged) {
    const entry = nextManifest.files[file.path];
    if (entry) nextManifest.files[file.path] = { ...entry, size: file.size, mtimeMs: file.mtimeMs };
  }

  self.reportProgress(onProgress, "finalizing", 99.9);
  nextManifest.state = "ready";
  nextManifest.updatedAt = indexedAt;
  nextManifest.sourceRevision = getGitInfo(self.workspaceRoot).commit || undefined;
  nextManifest.chunkCount = Object.values(nextManifest.files).reduce((total, file) => total + file.chunkCount, 0);
  nextManifest.sparse.driftFileCount += plan.added.length + plan.changed.length + plan.deleted.length;

  delete nextManifest.lastError;
  writeManifestAtomic(self.manifestPath, nextManifest);
  self.manifest = nextManifest;
  self.state = "ready";
  self.staleReason = undefined;
  self.lastError = undefined;
  self.reportProgress(onProgress, "finalizing", 100);
  return self.summaryForPlan(plan, startedAt, chunksEmbedded, false);
}

export function do_isReusablePoint(
  _self: WorkspaceCodeRagService,
  point: StoredVectorPoint,
  entries: Map<string, ManifestFileEntry>,
): boolean {
  return entries.get(point.payload.path)?.hash === point.payload.fileHash;
}

export function do_assertReusableCounts(
  _self: WorkspaceCodeRagService,
  entries: Map<string, ManifestFileEntry>,
  actual: Map<string, number>,
): void {
  for (const [filePath, entry] of entries) {
    if ((actual.get(filePath) ?? 0) !== entry.chunkCount) {
      throw new ReusableGenerationError(`Stored chunks are incomplete for unchanged file: ${filePath}`);
    }
  }
}

export function do_fallbackRebuildProgress(
  _self: WorkspaceCodeRagService,
  onProgress: RefreshIndexOptions["onProgress"],
): RefreshIndexOptions["onProgress"] {
  if (!onProgress) return undefined;
  return (progress) => {
    onProgress(progress);
  };
}

export function do_refreshSettingsSilently(self: WorkspaceCodeRagService): void {
  try {
    self.settings = loadWorkspaceCodeRagSettings(self.serviceOptions);
  } catch {
    // Best-effort settings reload; keep existing settings if config reading fails.
  }
}

export async function do_encodeSpoolAndUpsert(
  self: WorkspaceCodeRagService,
  collection: string,
  spoolPath: string,
  totalChunks: number,
  vocabulary: BM25Vocabulary,
  signal: AbortSignal,
  onProgress: (completed: number, total: number) => void,
): Promise<void> {
  const input = fs.createReadStream(spoolPath, { encoding: "utf-8" });
  const lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
  const pending: PreparedChunk[] = [];
  let completed = 0;
  try {
    for await (const line of lines) {
      if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
      if (!line) continue;
      pending.push(JSON.parse(line) as PreparedChunk);
      self.refreshSettingsSilently();
      const batchSize = Math.max(1, self.settings.encodeBatchSize);
      if (pending.length < batchSize) continue;
      const batch = pending.splice(0, batchSize);
      await self.encodeAndUpsert(collection, batch, vocabulary, signal);
      completed += batch.length;
      onProgress(completed, totalChunks);
    }
    if (pending.length > 0) {
      await self.encodeAndUpsert(collection, pending, vocabulary, signal);
      completed += pending.length;
    }
    onProgress(completed, totalChunks);
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function do_encodeAndUpsert(
  self: WorkspaceCodeRagService,
  collection: string,
  chunks: PreparedChunk[],
  vocabulary: BM25Vocabulary,
  signal: AbortSignal,
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  if (chunks.length === 0) {
    onProgress?.(0, 0);
    return;
  }
  if (self.settings.searchMode !== "bm25-only" && self.embeddingProvider.ensureReady) {
    await self.embeddingProvider.ensureReady(signal);
  }
  let offset = 0;
  while (offset < chunks.length) {
    if (signal.aborted) throw signal.reason ?? new Error("Code RAG refresh cancelled");
    self.refreshSettingsSilently();
    const encodeBatchSize = Math.max(1, self.settings.encodeBatchSize);
    const upsertBatchSize = Math.max(1, self.settings.upsertBatchSize);
    const batch = chunks.slice(offset, offset + encodeBatchSize);
    const denseVectors =
      self.settings.searchMode === "bm25-only"
        ? batch.map(() => new Float32Array(0))
        : await self.embeddingProvider.encode(
            batch.map((chunk) => chunk.retrievalText),
            signal,
          );
    if (denseVectors.length !== batch.length) throw new Error("Embedding provider returned an incomplete batch");
    const points: VectorPoint[] = batch.map((chunk, index) => ({
      id: chunk.id,
      vectors: {
        ...(denseVectors[index].length > 0 ? { dense: Array.from(denseVectors[index]) } : {}),
        sparse: vocabulary.encode(chunk.retrievalText),
      },
      payload: chunk.payload,
    }));
    for (let pointOffset = 0; pointOffset < points.length; pointOffset += upsertBatchSize) {
      await self.vectorStore.upsert(collection, points.slice(pointOffset, pointOffset + upsertBatchSize));
    }
    offset += batch.length;
    onProgress?.(Math.min(offset, chunks.length), chunks.length);
  }
}

export function do_reportProgress(
  _self: WorkspaceCodeRagService,
  onProgress: RefreshIndexOptions["onProgress"],
  phase: IndexingProgress["phase"],
  percent: number,
  filesInfo?: { processedFiles?: number; totalFiles?: number },
  chunksInfo?: {
    processedChunks?: number;
    totalChunks?: number;
    reusedChunks?: number;
    recalculatedChunks?: number;
    recalculatedTotal?: number;
  },
): void {
  try {
    const roundedPercent = Math.max(0, Math.min(100, Math.round(percent * 10) / 10));
    onProgress?.({
      phase,
      percent: roundedPercent,
      processedFiles: filesInfo?.processedFiles,
      totalFiles: filesInfo?.totalFiles,
      processedChunks: chunksInfo?.processedChunks,
      totalChunks: chunksInfo?.totalChunks,
      reusedChunks: chunksInfo?.reusedChunks,
      recalculatedChunks: chunksInfo?.recalculatedChunks,
      recalculatedTotal: chunksInfo?.recalculatedTotal,
    });
  } catch {
    // Progress reporting must not interrupt indexing.
  }
}
