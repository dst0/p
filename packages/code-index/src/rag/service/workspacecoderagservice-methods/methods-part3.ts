import fs from "node:fs";
import path from "node:path";
import { BM25Vocabulary } from "../../../bm25.ts";
import { getGitInfo } from "../../../discover.ts";
import { FilePreparationTaskError, type ScannedFile } from "../../file-preparation-core.ts";
import { CHUNKER_NAME, CHUNKER_VERSION, INDEX_MANIFEST_SCHEMA_VERSION, writeManifestAtomic } from "../../manifest.ts";
import type { IndexManifest, IndexUpdateSummary, ManifestFileEntry, RefreshIndexOptions } from "../../types.ts";
import { unlinkBestEffort } from "../helpers.ts";
import type { RefreshPlan } from "../types.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export async function do_performRebuild(
  self: WorkspaceCodeRagService,
  scanned: ScannedFile[],
  plan: RefreshPlan,
  startedAt: number,
  signal: AbortSignal,
  onProgress: RefreshIndexOptions["onProgress"],
): Promise<IndexUpdateSummary> {
  const generation = self.createGeneration();
  const collection = self.collectionName(generation);
  const vocabulary = new BM25Vocabulary();
  const manifestFiles: Record<string, ManifestFileEntry> = {};
  self.assertSpoolCapacity(scanned);
  const spoolPath = path.join(self.repositoryDirectory, `.preparation-${generation}-${process.pid}.jsonl`);
  const spool = fs.openSync(spoolPath, "wx", 0o600);
  let chunkCount = 0;
  let createdCollection = false;
  let newVocabularyPath: string | undefined;
  try {
    const vocabularyTokenLimit = self.sparseVocabularyTokenLimit();
    await self.processPreparedFiles(scanned, generation, signal, (prepared, index) => {
      manifestFiles[prepared.file.path] = prepared.entry;
      for (const chunk of prepared.chunks) {
        vocabulary.register(chunk.retrievalText);
        if (vocabulary.tokenToIdx.size > vocabularyTokenLimit) {
          throw new FilePreparationTaskError(
            "resource",
            `Sparse vocabulary exceeded its safe limit of ${vocabularyTokenLimit} tokens`,
          );
        }
        fs.writeFileSync(spool, `${JSON.stringify(chunk)}\n`, "utf-8");
        chunkCount += 1;
      }
      self.reportProgress(onProgress, "indexing", 5 + (10 * (index + 1)) / Math.max(scanned.length, 1), {
        processedFiles: index + 1,
        totalFiles: scanned.length,
      });
    });
    fs.fsyncSync(spool);
    vocabulary.finalize();
    await self.vectorStore.createCollection(collection, self.settings.embeddingDimensions);
    createdCollection = true;
    await self.encodeSpoolAndUpsert(collection, spoolPath, chunkCount, vocabulary, signal, (completed, total) => {
      self.reportProgress(
        onProgress,
        "indexing",
        15 + (84.8 * completed) / Math.max(total, 1),
        { processedFiles: scanned.length, totalFiles: scanned.length },
        { processedChunks: completed, totalChunks: total },
      );
    });
    self.reportProgress(
      onProgress,
      "finalizing",
      99.9,
      { processedFiles: scanned.length, totalFiles: scanned.length },
      { processedChunks: chunkCount, totalChunks: chunkCount },
    );
    const now = self.now().toISOString();
    newVocabularyPath = self.vocabularyPath(generation);
    vocabulary.save(newVocabularyPath);
    const previousManifest = self.manifest;
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
      },
      sparse: {
        strategy: "frozen-bm25",
        generation,
        vocabularyFile: path.basename(newVocabularyPath),
        corpusDocCount: vocabulary.totalDocs,
        frozenStatsAt: now,
        driftFileCount: 0,
      },
      files: manifestFiles,
      chunkCount,
    };
    writeManifestAtomic(self.manifestPath, manifest);
    self.manifest = manifest;
    self.state = "ready";
    self.staleReason = undefined;
    self.lastError = undefined;
    self.cachedVocabulary = vocabulary;
    self.cachedVocabularyGeneration = generation;
    createdCollection = false;

    if (previousManifest && previousManifest.collection !== collection) {
      try {
        await self.vectorStore.deleteCollection(previousManifest.collection);
      } catch {
        // The new manifest is already committed; old-generation cleanup is best effort.
      }
      const oldVocabularyPath = path.join(self.repositoryDirectory, previousManifest.sparse.vocabularyFile);
      try {
        fs.unlinkSync(oldVocabularyPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          // Old local vocabulary cleanup is best effort.
        }
      }
    }
    self.reportProgress(onProgress, "finalizing", 100);
    return self.summaryForPlan(plan, startedAt, chunkCount, true);
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
  } finally {
    fs.closeSync(spool);
    try {
      fs.unlinkSync(spoolPath);
    } catch {
      // The bounded preparation spool is best-effort cleanup after completion or failure.
    }
  }
}
