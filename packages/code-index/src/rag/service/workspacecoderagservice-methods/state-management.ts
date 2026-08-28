import fs from "node:fs";
import path from "node:path";
import { BM25Vocabulary } from "../../../bm25.ts";
import { discoverFilesWithOptions } from "../../../discover.ts";
import { computeEmbeddingCompatibilityGroup } from "../../config.ts";
import { CHUNKER_NAME, CHUNKER_VERSION, INDEX_MANIFEST_SCHEMA_VERSION, loadManifest } from "../../manifest.ts";
import type {
  IndexManifest,
  RagStatus,
  SemanticSearchHit,
  SemanticSearchInput,
  StoredChunkPayload,
} from "../../types.ts";
import { CodeRagError } from "../coderagerror.ts";
import { KNOWN_LANGUAGES, KNOWN_SYMBOL_TYPES } from "../constants.ts";
import { normalizePathFilter, normalizeRepositoryPath, safeErrorMessage } from "../helpers.ts";
import type { NormalizedSearchInput } from "../types.ts";
import type { WorkspaceCodeRagService } from "../workspacecoderagservice.ts";

export function do_updateFastFreshness(self: WorkspaceCodeRagService): void {
  if (!self.manifest || self.state === "unavailable" || self.state === "disabled") return;
  try {
    fs.statSync(self.workspaceRoot);
    const files = discoverFilesWithOptions(self.workspaceRoot, { maxFileSize: self.settings.maxFileBytes });
    if (files.length !== Object.keys(self.manifest.files).length) {
      self.state = "stale";
      self.staleReason = "The indexed file set changed";
      return;
    }
    for (const absPath of files) {
      const relativePath = normalizeRepositoryPath(path.relative(self.workspaceRoot, absPath));
      const entry = self.manifest.files[relativePath];
      const stat = fs.statSync(absPath);
      if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
        self.state = "stale";
        self.staleReason = `File changed: ${relativePath}`;
        return;
      }
    }
    self.state = self.manifest.state;
    self.staleReason = undefined;
  } catch (error) {
    self.state = "unavailable";
    self.lastError = self.errorInfo("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
  }
}

export async function do_reloadPersistedState(self: WorkspaceCodeRagService): Promise<void> {
  fs.mkdirSync(self.repositoryDirectory, { recursive: true, mode: 0o700 });
  const persisted = loadManifest(self.manifestPath);
  if (persisted?.generation !== self.manifest?.generation) {
    self.cachedVocabulary = undefined;
    self.cachedVocabularyGeneration = undefined;
  }
  self.manifest = persisted;
  self.initialized = true;
  self.staleReason = undefined;
  if (!persisted) {
    self.payloadIndexMaintenance = undefined;
    self.state = "not_initialized";
    self.lastError = undefined;
    return;
  }
  const incompatibility = self.manifestIncompatibility(persisted);
  if (incompatibility) {
    self.state = "stale";
    self.staleReason = incompatibility;
    self.lastError = self.errorInfo("RAG_INCOMPATIBLE_INDEX", incompatibility);
    return;
  }
  let collectionExists: boolean;
  try {
    collectionExists = await self.vectorStore.collectionExists(persisted.collection);
  } catch (error) {
    throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
  }
  if (!collectionExists) {
    self.payloadIndexMaintenance = undefined;
    self.state = "stale";
    self.staleReason = "Qdrant collection is missing";
    self.lastError = self.errorInfo("RAG_INCOMPATIBLE_INDEX", self.staleReason);
    return;
  }
  if (self.payloadIndexMaintenance?.collection !== persisted.collection) self.payloadIndexMaintenance = undefined;
  self.state = persisted.state;
  self.lastError = undefined;
  // lastError is a transient diagnostic. A successful compatible reload clears it
  // instead of restoring a stale failure persisted by an earlier indexing attempt.
}

export function do_startPayloadIndexMaintenance(self: WorkspaceCodeRagService, collection: string): void {
  const createPayloadIndexes = self.vectorStore.createPayloadIndexes;
  if (!createPayloadIndexes || self.payloadIndexMaintenance?.collection === collection) return;
  const promise = Promise.resolve().then(() => createPayloadIndexes.call(self.vectorStore, collection));
  self.payloadIndexMaintenance = { collection, promise };
  void promise.catch(() => {});
}

export async function do_waitForPayloadIndexMaintenance(self: WorkspaceCodeRagService): Promise<void> {
  const collection = self.manifest?.collection;
  if (!collection || self.lastError?.code === "RAG_INCOMPATIBLE_INDEX") return;
  self.startPayloadIndexMaintenance(collection);
  const maintenance = self.payloadIndexMaintenance;
  if (!maintenance || maintenance.collection !== collection) return;
  try {
    await maintenance.promise;
  } catch (error) {
    if (self.payloadIndexMaintenance === maintenance) self.payloadIndexMaintenance = undefined;
    throw new CodeRagError("RAG_BACKEND_UNAVAILABLE", safeErrorMessage(error));
  }
}

export function do_manifestIncompatibility(self: WorkspaceCodeRagService, manifest: IndexManifest): string | undefined {
  if (manifest.schemaVersion !== INDEX_MANIFEST_SCHEMA_VERSION) return "Index schema changed";
  if (manifest.repoId !== self.repoId || manifest.root !== self.workspaceRoot) return "Repository identity changed";
  if (manifest.chunker.name !== CHUNKER_NAME || manifest.chunker.version !== CHUNKER_VERSION) {
    return "Chunker version changed";
  }
  if (
    manifest.chunker.defaultChunkLines !== self.settings.defaultChunkLines ||
    manifest.chunker.maxChunkLines !== self.settings.maxChunkLines
  ) {
    return "Chunker settings changed";
  }
  if (
    manifest.embedding.model !== self.settings.embeddingModel ||
    manifest.embedding.dimensions !== self.settings.embeddingDimensions
  ) {
    return "Embedding model or dimensions changed";
  }
  const expectedCompatibilityGroup = computeEmbeddingCompatibilityGroup(
    self.settings.embeddingModel,
    self.settings.embeddingDimensions,
    self.settings.embeddingPooling,
    self.settings.embeddingNormalization,
    self.settings.searchMode,
  );
  if (
    manifest.embedding.compatibilityGroup !== expectedCompatibilityGroup ||
    manifest.embedding.pooling !== self.settings.embeddingPooling ||
    manifest.embedding.normalization !== self.settings.embeddingNormalization
  ) {
    return "Embedding compatibility metadata changed";
  }
  if (!manifest.sparse.vocabularyFile) return "Sparse vocabulary metadata is missing";
  const vocabularyPath = path.join(self.repositoryDirectory, manifest.sparse.vocabularyFile);
  if (!fs.existsSync(vocabularyPath)) return "Sparse vocabulary file is missing";
  return undefined;
}

export function do_loadVocabulary(self: WorkspaceCodeRagService, manifest: IndexManifest): BM25Vocabulary {
  if (self.cachedVocabulary && self.cachedVocabularyGeneration === manifest.sparse.generation) {
    return self.cachedVocabulary;
  }
  const vocabularyPath = path.join(self.repositoryDirectory, manifest.sparse.vocabularyFile);
  if (!fs.existsSync(vocabularyPath)) throw new CodeRagError("RAG_INCOMPATIBLE_INDEX", "Sparse vocabulary is missing");
  self.cachedVocabulary = BM25Vocabulary.load(vocabularyPath);
  self.cachedVocabularyGeneration = manifest.sparse.generation;
  return self.cachedVocabulary;
}

export function do_normalizeSearchInput(
  self: WorkspaceCodeRagService,
  input: SemanticSearchInput,
): NormalizedSearchInput {
  const query = input.query.trim();
  if (!query) throw new CodeRagError("RAG_INVALID_QUERY", "Semantic search query must not be empty");
  const requestedLimit = input.limit ?? self.settings.defaultLimit;
  const limit = Math.min(self.settings.maxLimit, Math.max(1, Math.floor(requestedLimit)));
  let pathPrefix: string | undefined;
  if (input.pathPrefix !== undefined) {
    pathPrefix = normalizePathFilter(input.pathPrefix);
  }
  const languages = input.languages?.map((language) => language.toLowerCase());
  for (const language of languages ?? []) {
    if (!KNOWN_LANGUAGES.has(language))
      throw new CodeRagError("RAG_INVALID_QUERY", `Unknown language filter: ${language}`);
  }
  const symbolTypes = input.symbolTypes?.map((symbolType) => symbolType.toLowerCase());
  for (const symbolType of symbolTypes ?? []) {
    if (!KNOWN_SYMBOL_TYPES.has(symbolType)) {
      throw new CodeRagError("RAG_INVALID_QUERY", `Unknown symbol type filter: ${symbolType}`);
    }
  }
  return {
    query,
    limit,
    pathPrefix,
    languages: languages && languages.length > 0 ? [...new Set(languages)] : undefined,
    symbolTypes: symbolTypes && symbolTypes.length > 0 ? [...new Set(symbolTypes)] : undefined,
    includeTests: input.includeTests ?? true,
    includeGenerated: input.includeGenerated ?? false,
    freshness: input.freshness ?? "prefer_fresh",
  };
}

export function do_formatHits(
  self: WorkspaceCodeRagService,
  candidates: Array<{ score: number; payload: StoredChunkPayload }>,
  input: NormalizedSearchInput,
): { hits: SemanticSearchHit[]; truncated: boolean } {
  const hits: SemanticSearchHit[] = [];
  const seen = new Set<string>();
  const perFile = new Map<string, number>();
  let characters = 0;
  let truncated = false;
  for (const candidate of candidates) {
    const payload = candidate.payload;
    if (input.pathPrefix && payload.path !== input.pathPrefix && !payload.path.startsWith(`${input.pathPrefix}/`))
      continue;
    if (input.symbolTypes && !input.symbolTypes.includes(payload.symbolType)) continue;
    const dedupeKey = `${payload.path}:${payload.startLine}:${payload.endLine}:${payload.chunkHash}`;
    if (seen.has(dedupeKey) || (perFile.get(payload.path) ?? 0) >= 3) continue;
    let content = payload.content;
    if (content.length > self.settings.maxResultCharacters) {
      content = `${content.slice(0, self.settings.maxResultCharacters)}\n[snippet truncated]`;
      truncated = true;
    }
    if (characters + content.length > self.settings.maxContextCharacters) {
      truncated = true;
      break;
    }
    seen.add(dedupeKey);
    perFile.set(payload.path, (perFile.get(payload.path) ?? 0) + 1);
    characters += content.length;
    hits.push({
      rank: hits.length + 1,
      path: payload.path,
      startLine: payload.startLine,
      endLine: payload.endLine,
      language: payload.language,
      symbolName: payload.symbolName || undefined,
      symbolType: payload.symbolType,
      score: candidate.score,
      content,
    });
    if (hits.length >= input.limit) break;
  }
  return { hits, truncated };
}

export function do_snapshotStatus(self: WorkspaceCodeRagService): RagStatus {
  return {
    state: self.state,
    workspaceRoot: self.workspaceRoot,
    repoId: self.repoId,
    collection: self.manifest?.collection,
    generation: self.manifest?.generation,
    createdAt: self.manifest?.createdAt,
    updatedAt: self.manifest?.updatedAt,
    indexedFiles: Object.keys(self.manifest?.files ?? {}).length,
    indexedChunks: self.manifest?.chunkCount ?? 0,
    staleReason: self.staleReason,
    sparse: {
      generation: self.manifest?.sparse.generation,
      exact: (self.manifest?.sparse.driftFileCount ?? 0) === 0,
      driftFileCount: self.manifest?.sparse.driftFileCount ?? 0,
    },
    preparation: self.lastPreparationPlan ? { ...self.lastPreparationPlan } : undefined,
    lastError: self.lastError,
  };
}
