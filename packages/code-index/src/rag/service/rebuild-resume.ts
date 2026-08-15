import fs from "node:fs";
import { BM25Vocabulary } from "../../bm25.ts";
import { FilePreparationTaskError, type ScannedFile } from "../file-preparation-core.ts";
import type { ManifestFileEntry, RefreshIndexOptions } from "../types.ts";
import {
  loadRebuildCheckpoint,
  loadRebuildPlan,
  REBUILD_CHECKPOINT_SCHEMA_VERSION,
  type RebuildArtifacts,
  type RebuildCheckpoint,
  type RebuildPlan,
  rebuildArtifacts,
  rebuildCheckpointPath,
  rebuildCompatibilityFingerprint,
  removeRebuildArtifacts,
  sourceFingerprintForManifest,
  sourceFingerprintForScanned,
  writeRebuildCheckpoint,
  writeRebuildPlan,
} from "./rebuild-checkpoint.ts";
import type { WorkspaceCodeRagService } from "./workspacecoderagservice.ts";

export interface ActiveRebuild {
  checkpoint: RebuildCheckpoint;
  artifacts: RebuildArtifacts;
  plan: RebuildPlan;
  vocabulary: BM25Vocabulary;
  resumed: boolean;
}

export async function loadActiveRebuild(
  self: WorkspaceCodeRagService,
  scanned: ScannedFile[],
): Promise<ActiveRebuild | undefined> {
  const checkpointPath = rebuildCheckpointPath(self.repositoryDirectory);
  const checkpoint = loadRebuildCheckpoint(checkpointPath);
  if (!checkpoint) {
    if (fs.existsSync(checkpointPath)) unlinkBestEffort(checkpointPath);
    return undefined;
  }
  const artifacts = rebuildArtifacts(self.repositoryDirectory, checkpoint.generation);
  const plan = loadRebuildPlan(artifacts.plan, checkpoint.generation);
  const expectedCompatibility = rebuildCompatibilityFingerprint(self.repoId, self.workspaceRoot, self.settings);
  const expectedSource = sourceFingerprintForScanned(scanned);
  const expectedCollection = self.collectionName(checkpoint.generation);
  const invalid =
    checkpoint.repoId !== self.repoId ||
    checkpoint.root !== self.workspaceRoot ||
    checkpoint.collection !== expectedCollection ||
    checkpoint.compatibilityFingerprint !== expectedCompatibility ||
    checkpoint.sourceFingerprint !== expectedSource ||
    !plan ||
    sourceFingerprintForManifest(plan.files) !== checkpoint.sourceFingerprint ||
    Object.values(plan.files).reduce((total, file) => total + file.chunkCount, 0) !== checkpoint.chunkCount ||
    !fs.existsSync(artifacts.spool) ||
    !fs.existsSync(artifacts.vocabulary);
  if (invalid || !plan) {
    await discardActiveRebuild(self, { checkpoint, artifacts });
    return undefined;
  }

  let vocabulary: BM25Vocabulary;
  try {
    vocabulary = BM25Vocabulary.load(artifacts.vocabulary);
  } catch {
    await discardActiveRebuild(self, { checkpoint, artifacts });
    return undefined;
  }
  if (vocabulary.totalDocs !== checkpoint.chunkCount) {
    await discardActiveRebuild(self, { checkpoint, artifacts });
    return undefined;
  }

  const collectionExists = await self.vectorStore.collectionExists(checkpoint.collection);
  if (!collectionExists) {
    if (checkpoint.completedChunks > 0) {
      removeRebuildArtifacts(artifacts);
      return undefined;
    }
    await self.vectorStore.createCollection(checkpoint.collection, self.settings.embeddingDimensions);
  } else {
    const status = await self.vectorStore.collectionStatus(checkpoint.collection);
    if (
      status.dimensions !== self.settings.embeddingDimensions ||
      status.points < checkpoint.completedChunks ||
      status.points > checkpoint.chunkCount
    ) {
      await discardActiveRebuild(self, { checkpoint, artifacts });
      return undefined;
    }
  }
  return { checkpoint, artifacts, plan, vocabulary, resumed: true };
}

export async function prepareActiveRebuild(
  self: WorkspaceCodeRagService,
  scanned: ScannedFile[],
  signal: AbortSignal,
  onProgress: RefreshIndexOptions["onProgress"],
): Promise<ActiveRebuild> {
  self.assertSpoolCapacity(scanned);
  const generation = self.createGeneration();
  const collection = self.collectionName(generation);
  const artifacts = rebuildArtifacts(self.repositoryDirectory, generation);
  const vocabulary = new BM25Vocabulary();
  const manifestFiles: Record<string, ManifestFileEntry> = {};
  const spool = fs.openSync(artifacts.spool, "wx", 0o600);
  let spoolOpen = true;
  let chunkCount = 0;
  let collectionCreated = false;
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
      self.reportProgress(onProgress, "preparing", (100 * (index + 1)) / Math.max(scanned.length, 1), {
        processedFiles: index + 1,
        totalFiles: scanned.length,
      });
    });
    fs.fsyncSync(spool);
    fs.closeSync(spool);
    spoolOpen = false;
    vocabulary.finalize();
    vocabulary.save(artifacts.vocabulary);
    const plan: RebuildPlan = {
      schemaVersion: REBUILD_CHECKPOINT_SCHEMA_VERSION,
      generation,
      files: manifestFiles,
    };
    writeRebuildPlan(artifacts.plan, plan);
    const checkpoint: RebuildCheckpoint = {
      schemaVersion: REBUILD_CHECKPOINT_SCHEMA_VERSION,
      repoId: self.repoId,
      root: self.workspaceRoot,
      generation,
      collection,
      sourceFingerprint: sourceFingerprintForManifest(manifestFiles),
      compatibilityFingerprint: rebuildCompatibilityFingerprint(self.repoId, self.workspaceRoot, self.settings),
      chunkCount,
      completedChunks: 0,
      createdAt: self.now().toISOString(),
    };
    writeRebuildCheckpoint(artifacts.checkpoint, checkpoint);
    await self.vectorStore.createCollection(collection, self.settings.embeddingDimensions);
    collectionCreated = true;
    return { checkpoint, artifacts, plan, vocabulary, resumed: false };
  } catch (error) {
    if (spoolOpen) fs.closeSync(spool);
    if (collectionCreated) await deleteCollectionBestEffort(self, collection);
    removeRebuildArtifacts(artifacts);
    throw error;
  }
}

export function commitRebuildProgress(active: ActiveRebuild, completedChunks: number): void {
  active.checkpoint = { ...active.checkpoint, completedChunks };
  writeRebuildCheckpoint(active.artifacts.checkpoint, active.checkpoint);
}

export async function discardActiveRebuild(
  self: WorkspaceCodeRagService,
  active: Pick<ActiveRebuild, "checkpoint" | "artifacts">,
): Promise<void> {
  if (active.checkpoint.collection !== self.manifest?.collection) {
    await deleteCollectionBestEffort(self, active.checkpoint.collection);
  }
  removeRebuildArtifacts(active.artifacts);
}

export function completeRebuild(active: ActiveRebuild): void {
  removeRebuildArtifacts(active.artifacts, true);
}

async function deleteCollectionBestEffort(self: WorkspaceCodeRagService, collection: string): Promise<void> {
  try {
    if (await self.vectorStore.collectionExists(collection)) await self.vectorStore.deleteCollection(collection);
  } catch {
    // Preserve the primary rebuild result while cleanup remains retryable by backend maintenance.
  }
}

function unlinkBestEffort(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      // Invalid checkpoint cleanup is best effort.
    }
  }
}
