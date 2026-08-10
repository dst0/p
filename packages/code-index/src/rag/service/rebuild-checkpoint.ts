import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { computeEmbeddingCompatibilityGroup } from "../config.ts";
import type { ScannedFile } from "../file-preparation-core.ts";
import { CHUNKER_NAME, CHUNKER_VERSION, INDEX_MANIFEST_SCHEMA_VERSION } from "../manifest.ts";
import type { ManifestFileEntry, WorkspaceCodeRagSettings } from "../types.ts";

export const REBUILD_CHECKPOINT_SCHEMA_VERSION = 1;
export const REBUILD_CHECKPOINT_FILENAME = "rebuild-checkpoint.json";

export interface RebuildCheckpoint {
  schemaVersion: number;
  repoId: string;
  root: string;
  generation: string;
  collection: string;
  sourceFingerprint: string;
  compatibilityFingerprint: string;
  chunkCount: number;
  completedChunks: number;
  createdAt: string;
}

export interface RebuildPlan {
  schemaVersion: number;
  generation: string;
  files: Record<string, ManifestFileEntry>;
}

export interface RebuildArtifacts {
  checkpoint: string;
  spool: string;
  plan: string;
  vocabulary: string;
}

interface SourceFingerprintEntry {
  path: string;
  hash: string;
  size: number;
  language: string;
  isTest: boolean;
  isGenerated: boolean;
}

export function rebuildCheckpointPath(repositoryDirectory: string): string {
  return path.join(repositoryDirectory, REBUILD_CHECKPOINT_FILENAME);
}

export function rebuildArtifacts(repositoryDirectory: string, generation: string): RebuildArtifacts {
  return {
    checkpoint: rebuildCheckpointPath(repositoryDirectory),
    spool: path.join(repositoryDirectory, `.rebuild-${generation}.jsonl`),
    plan: path.join(repositoryDirectory, `.rebuild-${generation}.plan.json`),
    vocabulary: path.join(repositoryDirectory, `bm25-${generation}.json`),
  };
}

export function sourceFingerprintForScanned(files: ScannedFile[]): string {
  return sourceFingerprint(files);
}

export function sourceFingerprintForManifest(files: Record<string, ManifestFileEntry>): string {
  return sourceFingerprint(
    Object.entries(files).map(([filePath, entry]) => ({
      path: filePath,
      hash: entry.hash,
      size: entry.size,
      language: entry.language,
      isTest: entry.isTest,
      isGenerated: entry.isGenerated,
    })),
  );
}

export function rebuildCompatibilityFingerprint(
  repoId: string,
  root: string,
  settings: WorkspaceCodeRagSettings,
): string {
  const compatibility = {
    schemaVersion: INDEX_MANIFEST_SCHEMA_VERSION,
    repoId,
    root,
    chunker: {
      name: CHUNKER_NAME,
      version: CHUNKER_VERSION,
      defaultChunkLines: settings.defaultChunkLines,
      maxChunkLines: settings.maxChunkLines,
    },
    embedding: {
      model: settings.embeddingModel,
      dimensions: settings.embeddingDimensions,
      compatibilityGroup: computeEmbeddingCompatibilityGroup(
        settings.embeddingModel,
        settings.embeddingDimensions,
        settings.embeddingPooling,
        settings.embeddingNormalization,
        settings.searchMode,
      ),
      pooling: settings.embeddingPooling,
      normalization: settings.embeddingNormalization,
      maxSequenceLength: settings.maxSequenceLength,
    },
    sparse: {
      searchMode: settings.searchMode,
      maxEncodeCharacters: settings.maxEncodeCharacters,
      maxSparseVocabularyTokens: settings.maxSparseVocabularyTokens,
    },
  };
  return createHash("sha256").update(JSON.stringify(compatibility)).digest("hex");
}

export function loadRebuildCheckpoint(checkpointPath: string): RebuildCheckpoint | undefined {
  if (!fs.existsSync(checkpointPath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(checkpointPath, "utf-8")) as unknown;
    return isRebuildCheckpoint(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function loadRebuildPlan(planPath: string, generation: string): RebuildPlan | undefined {
  if (!fs.existsSync(planPath)) return undefined;
  try {
    const value = JSON.parse(fs.readFileSync(planPath, "utf-8")) as unknown;
    return isRebuildPlan(value, generation) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeRebuildCheckpoint(checkpointPath: string, checkpoint: RebuildCheckpoint): void {
  writeJsonAtomic(checkpointPath, checkpoint);
}

export function writeRebuildPlan(planPath: string, plan: RebuildPlan): void {
  writeJsonAtomic(planPath, plan);
}

export function removeRebuildArtifacts(artifacts: RebuildArtifacts, keepVocabulary = false): void {
  for (const artifact of [artifacts.checkpoint, artifacts.spool, artifacts.plan]) unlinkBestEffort(artifact);
  if (!keepVocabulary) unlinkBestEffort(artifacts.vocabulary);
}

function sourceFingerprint(files: SourceFingerprintEntry[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(JSON.stringify([file.path, file.hash, file.size, file.language, file.isTest, file.isGenerated]));
    hash.update("\n");
  }
  return hash.digest("hex");
}

function isRebuildCheckpoint(value: unknown): value is RebuildCheckpoint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RebuildCheckpoint>;
  return (
    candidate.schemaVersion === REBUILD_CHECKPOINT_SCHEMA_VERSION &&
    typeof candidate.repoId === "string" &&
    typeof candidate.root === "string" &&
    typeof candidate.generation === "string" &&
    /^[a-zA-Z0-9_-]+$/.test(candidate.generation) &&
    typeof candidate.collection === "string" &&
    typeof candidate.sourceFingerprint === "string" &&
    typeof candidate.compatibilityFingerprint === "string" &&
    typeof candidate.chunkCount === "number" &&
    Number.isSafeInteger(candidate.chunkCount) &&
    candidate.chunkCount >= 0 &&
    typeof candidate.completedChunks === "number" &&
    Number.isSafeInteger(candidate.completedChunks) &&
    candidate.completedChunks >= 0 &&
    candidate.completedChunks <= candidate.chunkCount &&
    typeof candidate.createdAt === "string"
  );
}

function isRebuildPlan(value: unknown, generation: string): value is RebuildPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<RebuildPlan>;
  if (
    candidate.schemaVersion !== REBUILD_CHECKPOINT_SCHEMA_VERSION ||
    candidate.generation !== generation ||
    !candidate.files ||
    typeof candidate.files !== "object" ||
    Array.isArray(candidate.files)
  ) {
    return false;
  }
  return Object.values(candidate.files).every(isManifestFileEntry);
}

function isManifestFileEntry(value: unknown): value is ManifestFileEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<ManifestFileEntry>;
  return (
    typeof entry.hash === "string" &&
    typeof entry.size === "number" &&
    typeof entry.mtimeMs === "number" &&
    typeof entry.chunkCount === "number" &&
    typeof entry.indexedAt === "string" &&
    typeof entry.language === "string" &&
    typeof entry.isTest === "boolean" &&
    typeof entry.isGenerated === "boolean"
  );
}

function writeJsonAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  const file = fs.openSync(temporaryPath, "w", 0o600);
  try {
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
    fs.fsyncSync(file);
  } finally {
    fs.closeSync(file);
  }
  fs.renameSync(temporaryPath, filePath);
}

function unlinkBestEffort(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      // Rebuild artifact cleanup is best effort.
    }
  }
}
