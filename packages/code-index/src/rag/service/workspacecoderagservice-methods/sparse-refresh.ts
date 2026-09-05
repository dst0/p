import fs from "node:fs";
import path from "node:path";
import { BM25Vocabulary } from "../../../bm25.ts";
import { getGitInfo } from "../../../discover.ts";
import { computeEmbeddingCompatibilityGroup } from "../../config.ts";
import type { ScannedFile } from "../../file-preparation-core.ts";
import { CHUNKER_NAME, CHUNKER_VERSION, INDEX_MANIFEST_SCHEMA_VERSION, writeManifestAtomic } from "../../manifest.ts";
import type {
  IndexManifest,
  IndexUpdateSummary,
  ManifestFileEntry,
  RefreshIndexOptions,
  VectorPoint,
} from "../../types.ts";
import { StoredPointError } from "../../vector-store.ts";
import { CodeRagError } from "../coderagerror.ts";
import { SCROLL_PROGRESS_INTERVAL } from "../constants.ts";
import { retrievalTextForPayload, unlinkBestEffort, waitForSignal } from "../helpers.ts";
import { ReusableGenerationError } from "../reusablegenerationerror.ts";
import type { PreparedFile, RefreshPlan } from "../types.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export async function do_performSparseGenerationRefresh(
  self: WorkspaceCodeRagService,
  scanned: ScannedFile[],
  plan: RefreshPlan,
  startedAt: number,
  signal: AbortSignal,
  onProgress: RefreshIndexOptions["onProgress"],
): Promise<IndexUpdateSummary> {
  if (!self.manifest) throw new CodeRagError("RAG_NOT_INITIALIZED", "Code RAG index is not initialized");
  const iteratePoints = self.vectorStore.iteratePoints?.bind(self.vectorStore);
  if (!iteratePoints) {
    return self.performRebuild(scanned, plan, startedAt, signal, onProgress);
  }
  await waitForSignal(self.waitForPayloadIndexMaintenance(), signal);

  const previousManifest = self.manifest;
  const generation = self.createGeneration();
  const collection = self.collectionName(generation);
  const changedFiles = [...plan.added, ...plan.changed];
  const preparedFiles: PreparedFile[] = [];
  await self.processPreparedFiles(changedFiles, generation, signal, (prepared, index) => {
    preparedFiles.push(prepared);
    self.reportProgress(onProgress, "preparing", (50 * (index + 1)) / Math.max(changedFiles.length, 1), {
      processedFiles: index + 1,
      totalFiles: scanned.length,
    });
  });

  const reusableEntries = new Map<string, ManifestFileEntry>();
  const nextFiles: Record<string, ManifestFileEntry> = {};
  for (const file of plan.unchanged) {
    const entry = previousManifest.files[file.path];
    if (!entry) {
      return self.performRebuild(scanned, plan, startedAt, signal, self.fallbackRebuildProgress(onProgress));
    }
    reusableEntries.set(file.path, entry);
    nextFiles[file.path] = { ...entry, size: file.size, mtimeMs: file.mtimeMs };
  }
  for (const prepared of preparedFiles) nextFiles[prepared.file.path] = prepared.entry;

  const changedChunks = preparedFiles.flatMap((file) => file.chunks);
  const reusableChunkTotal = [...reusableEntries.values()].reduce((total, entry) => total + entry.chunkCount, 0);
  const totalChunks = reusableChunkTotal + changedChunks.length;
  const vocabulary = new BM25Vocabulary();
  for (const chunk of changedChunks) vocabulary.register(chunk.retrievalText);

  const vocabularyCounts = new Map<string, number>();
  let vocabularyChunkCount = 0;
  try {
    for await (const point of iteratePoints(previousManifest.collection, self.repoId, false, signal)) {
      if (!self.isReusablePoint(point, reusableEntries)) continue;
      vocabulary.register(retrievalTextForPayload(point.payload, self.settings.maxEncodeCharacters));
      vocabularyChunkCount += 1;
      vocabularyCounts.set(point.payload.path, (vocabularyCounts.get(point.payload.path) ?? 0) + 1);
      if (vocabularyChunkCount % SCROLL_PROGRESS_INTERVAL === 0) {
        self.reportProgress(
          onProgress,
          "preparing",
          50 + (50 * vocabularyChunkCount) / Math.max(reusableChunkTotal, 1),
          {
            processedFiles: changedFiles.length,
            totalFiles: scanned.length,
          },
        );
      }
    }
    self.assertReusableCounts(reusableEntries, vocabularyCounts);
    vocabulary.finalize();
    self.reportProgress(
      onProgress,
      "indexing",
      0,
      { processedFiles: changedFiles.length, totalFiles: scanned.length },
      { processedChunks: 0, totalChunks },
    );

    await self.vectorStore.createCollection(collection, self.settings.embeddingDimensions);
    let createdCollection = true;
    let newVocabularyPath: string | undefined;
    try {
      const copiedCounts = new Map<string, number>();
      const pending: VectorPoint[] = [];
      let copiedChunks = 0;
      const withDense = self.settings.searchMode !== "bm25-only";
      for await (const point of iteratePoints(previousManifest.collection, self.repoId, withDense, signal)) {
        if (!self.isReusablePoint(point, reusableEntries)) continue;
        if (withDense && (!point.dense || point.dense.length !== self.settings.embeddingDimensions)) {
          throw new ReusableGenerationError(`Dense vector is missing or incompatible for point: ${point.id}`);
        }
        pending.push({
          id: point.id,
          vectors: {
            ...(point.dense ? { dense: point.dense } : {}),
            sparse: vocabulary.encode(retrievalTextForPayload(point.payload, self.settings.maxEncodeCharacters)),
          },
          payload: { ...point.payload, indexGeneration: generation },
        });
        copiedChunks += 1;
        copiedCounts.set(point.payload.path, (copiedCounts.get(point.payload.path) ?? 0) + 1);
        self.refreshSettingsSilently();
        if (pending.length >= Math.max(1, self.settings.upsertBatchSize)) {
          await self.vectorStore.upsert(collection, pending.splice(0));
          self.reportProgress(
            onProgress,
            "indexing",
            (100 * copiedChunks) / Math.max(totalChunks, 1),
            { processedFiles: changedFiles.length, totalFiles: scanned.length },
            {
              processedChunks: copiedChunks,
              totalChunks,
              reusedChunks: copiedChunks,
              recalculatedChunks: 0,
              recalculatedTotal: changedChunks.length,
            },
          );
        }
      }
      if (pending.length > 0) await self.vectorStore.upsert(collection, pending);
      self.assertReusableCounts(reusableEntries, copiedCounts);
      self.reportProgress(
        onProgress,
        "indexing",
        (100 * reusableChunkTotal) / Math.max(totalChunks, 1),
        { processedFiles: plan.unchanged.length + changedFiles.length, totalFiles: scanned.length },
        {
          processedChunks: reusableChunkTotal,
          totalChunks,
          reusedChunks: reusableChunkTotal,
          recalculatedChunks: 0,
          recalculatedTotal: changedChunks.length,
        },
      );

      await self.encodeAndUpsert(collection, changedChunks, vocabulary, signal, (completed, total) => {
        self.reportProgress(
          onProgress,
          "indexing",
          (100 * (reusableChunkTotal + completed)) / Math.max(totalChunks, 1),
          { processedFiles: scanned.length, totalFiles: scanned.length },
          {
            processedChunks: reusableChunkTotal + completed,
            totalChunks,
            reusedChunks: reusableChunkTotal,
            recalculatedChunks: completed,
            recalculatedTotal: total,
          },
        );
      });
      self.reportProgress(
        onProgress,
        "finalizing",
        0,
        { processedFiles: scanned.length, totalFiles: scanned.length },
        {
          processedChunks: totalChunks,
          totalChunks,
          reusedChunks: reusableChunkTotal,
          recalculatedChunks: changedChunks.length,
          recalculatedTotal: changedChunks.length,
        },
      );

      const now = self.now().toISOString();
      newVocabularyPath = self.vocabularyPath(generation);
      vocabulary.save(newVocabularyPath);
      const manifest: IndexManifest = {
        schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
        repoId: self.repoId,
        root: self.workspaceRoot,
        collection,
        generation,
        state: "ready",
        createdAt: now,
        updatedAt: now,
        sourceRevision: getGitInfo(self.workspaceRoot).commit || undefined,
        chunker: {
          name: CHUNKER_NAME,
          version: CHUNKER_VERSION,
          defaultChunkLines: self.settings.defaultChunkLines,
          maxChunkLines: self.settings.maxChunkLines,
        },
        embedding: {
          provider: "local-python-http",
          model: self.settings.embeddingModel,
          dimensions: self.settings.embeddingDimensions,
          compatibilityGroup: computeEmbeddingCompatibilityGroup(
            self.settings.embeddingModel,
            self.settings.embeddingDimensions,
            self.settings.embeddingPooling,
            self.settings.embeddingNormalization,
            self.settings.searchMode,
          ),
          pooling: self.settings.embeddingPooling,
          normalization: self.settings.embeddingNormalization,
        },
        sparse: {
          strategy: "frozen-bm25",
          generation,
          vocabularyFile: path.basename(newVocabularyPath),
          corpusDocCount: vocabulary.totalDocs,
          frozenStatsAt: now,
          driftFileCount: 0,
        },
        files: nextFiles,
        chunkCount: totalChunks,
      };
      writeManifestAtomic(self.manifestPath, manifest);
      self.manifest = manifest;
      self.state = "ready";
      self.staleReason = undefined;
      self.lastError = undefined;
      self.cachedVocabulary = vocabulary;
      self.cachedVocabularyGeneration = generation;
      createdCollection = false;

      try {
        await self.vectorStore.deleteCollection(previousManifest.collection);
      } catch {
        // The new manifest is already committed; old-generation cleanup is best effort.
      }
      try {
        fs.unlinkSync(path.join(self.repositoryDirectory, previousManifest.sparse.vocabularyFile));
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          // Old local vocabulary cleanup is best effort.
        }
      }
      self.reportProgress(onProgress, "finalizing", 100);
      return self.summaryForPlan(plan, startedAt, changedChunks.length, false);
    } catch (error) {
      if (createdCollection) {
        try {
          await self.vectorStore.deleteCollection(collection);
        } catch {
          // Preserve the original failure.
        }
        if (newVocabularyPath) unlinkBestEffort(newVocabularyPath);
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof ReusableGenerationError || error instanceof StoredPointError) {
      return self.performRebuild(scanned, plan, startedAt, signal, self.fallbackRebuildProgress(onProgress));
    }
    throw error;
  }
}
