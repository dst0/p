import path from "node:path";
import { getGitInfo } from "../../../discover.ts";
import { computeEmbeddingCompatibilityGroup } from "../../config.ts";
import type { ScannedFile } from "../../file-preparation-core.ts";
import { CHUNKER_NAME, CHUNKER_VERSION, INDEX_MANIFEST_SCHEMA_VERSION, writeManifestAtomic } from "../../manifest.ts";
import type { IndexManifest, IndexUpdateSummary, RefreshIndexOptions } from "../../types.ts";
import { unlinkBestEffort } from "../helpers.ts";
import { rebuildCompatibilityFingerprint } from "../rebuild-checkpoint.ts";
import {
  type ActiveRebuild,
  commitRebuildProgress,
  completeRebuild,
  discardActiveRebuild,
  loadActiveRebuild,
  prepareActiveRebuild,
} from "../rebuild-resume.ts";
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
  const active =
    (await loadActiveRebuild(self, scanned)) ?? (await prepareActiveRebuild(self, scanned, signal, onProgress));
  const { checkpoint, vocabulary } = active;
  if (active.resumed) {
    self.reportProgress(onProgress, "preparing", 100, {
      processedFiles: scanned.length,
      totalFiles: scanned.length,
    });
  }
  self.reportProgress(
    onProgress,
    "indexing",
    (100 * checkpoint.completedChunks) / Math.max(checkpoint.chunkCount, 1),
    { processedFiles: scanned.length, totalFiles: scanned.length },
    { processedChunks: checkpoint.completedChunks, totalChunks: checkpoint.chunkCount },
  );

  try {
    await self.encodeSpoolAndUpsert(
      checkpoint.collection,
      active.artifacts.spool,
      checkpoint.chunkCount,
      vocabulary,
      signal,
      (completed, total) => {
        assertCheckpointCompatibility(self, active);
        commitRebuildProgress(active, completed);
        self.reportProgress(
          onProgress,
          "indexing",
          (100 * completed) / Math.max(total, 1),
          { processedFiles: scanned.length, totalFiles: scanned.length },
          { processedChunks: completed, totalChunks: total },
        );
      },
      checkpoint.completedChunks,
    );
    self.reportProgress(
      onProgress,
      "finalizing",
      0,
      { processedFiles: scanned.length, totalFiles: scanned.length },
      { processedChunks: checkpoint.chunkCount, totalChunks: checkpoint.chunkCount },
    );
    const previousManifest = self.manifest;
    const manifest = buildManifest(self, active);
    writeManifestAtomic(self.manifestPath, manifest);
    self.manifest = manifest;
    self.state = "ready";
    self.staleReason = undefined;
    self.lastError = undefined;
    self.cachedVocabulary = vocabulary;
    self.cachedVocabularyGeneration = checkpoint.generation;
    completeRebuild(active);

    if (previousManifest && previousManifest.collection !== checkpoint.collection) {
      try {
        await self.vectorStore.deleteCollection(previousManifest.collection);
      } catch {
        // The new manifest is already committed; old-generation cleanup is best effort.
      }
      unlinkBestEffort(path.join(self.repositoryDirectory, previousManifest.sparse.vocabularyFile));
    }
    self.reportProgress(onProgress, "finalizing", 100);
    return self.summaryForPlan(plan, startedAt, checkpoint.chunkCount, true);
  } catch (error) {
    const compatibilityUnchanged =
      active.checkpoint.compatibilityFingerprint ===
      rebuildCompatibilityFingerprint(self.repoId, self.workspaceRoot, self.settings);
    const hasReusableWork = active.checkpoint.completedChunks > 0 || signal.aborted;
    const canResume =
      compatibilityUnchanged && hasReusableWork && active.checkpoint.completedChunks < active.checkpoint.chunkCount;
    if (!canResume) await discardActiveRebuild(self, active);
    throw error;
  }
}

function buildManifest(self: WorkspaceCodeRagService, active: ActiveRebuild): IndexManifest {
  const { checkpoint, plan, vocabulary } = active;
  const now = self.now().toISOString();
  return {
    schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
    repoId: self.repoId,
    root: self.workspaceRoot,
    collection: checkpoint.collection,
    generation: checkpoint.generation,
    state: "ready",
    createdAt: checkpoint.createdAt,
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
      generation: checkpoint.generation,
      vocabularyFile: path.basename(active.artifacts.vocabulary),
      corpusDocCount: vocabulary.totalDocs,
      frozenStatsAt: now,
      driftFileCount: 0,
    },
    files: plan.files,
    chunkCount: checkpoint.chunkCount,
  };
}

function assertCheckpointCompatibility(self: WorkspaceCodeRagService, active: ActiveRebuild): void {
  const current = rebuildCompatibilityFingerprint(self.repoId, self.workspaceRoot, self.settings);
  if (current !== active.checkpoint.compatibilityFingerprint) {
    throw new Error("Rebuild compatibility settings changed while indexing");
  }
}
