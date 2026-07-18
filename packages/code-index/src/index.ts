export { BM25Vocabulary, computePointId } from "./bm25.ts";
export { chunkFile } from "./chunk.ts";
export { createConfig, DEFAULT_CONFIG, EXCLUDE_DIRS, EXCLUDE_EXTS, LANG_MAP } from "./config.ts";
export type { DiscoverFilesOptions } from "./discover.ts";
export {
	detectLanguage,
	discoverFiles,
	discoverFilesWithOptions,
	findRepos,
	getGitInfo,
	loadGitignore,
} from "./discover.ts";
export {
	type EmbeddingProvider,
	EmbeddingProviderHttp,
	EmbeddingServerManager,
	QdrantServerManager,
} from "./embed.ts";
export { CodeIndexer } from "./indexer.ts";
export { QdrantClient } from "./qdrant.ts";
export { DEFAULT_WORKSPACE_CODE_RAG_SETTINGS, loadWorkspaceCodeRagSettings } from "./rag/config.ts";
export { CodeRagError, WorkspaceCodeRagService } from "./rag/service.ts";
export type {
	CodeRagService,
	IndexManifest,
	IndexUpdateSummary,
	InitializeRagOptions,
	ManifestFileEntry,
	RagErrorCode,
	RagErrorInfo,
	RagState,
	RagStatus,
	RagVectorStore,
	RebuildIndexOptions,
	RefreshIndexOptions,
	SemanticSearchHit,
	SemanticSearchInput,
	SemanticSearchResponse,
	SparseVector,
	StoredChunkPayload,
	VectorPoint,
	VectorSearchFilters,
	VectorSearchResult,
	WorkspaceCodeRagServiceOptions,
	WorkspaceCodeRagSettings,
} from "./rag/types.ts";
export { QdrantVectorStore } from "./rag/vector-store.ts";
export type { Chunk, ChunkPayload, IndexConfig, IndexStats, IndexStatus, SearchResult } from "./types.ts";
