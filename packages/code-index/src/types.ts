/**
 * Core types for the code-index package.
 */

/** Configuration for the indexer. */
export interface IndexConfig {
	/** Qdrant server URL */
	qdrantUrl: string;
	/** Qdrant collection name */
	collection: string;
	/** Embedding model ID (for server) */
	modelId: string;
	/** Dense vector dimension */
	denseDim: number;
	/** Workspace root directory */
	workspace: string;
	/** BM25 k1 parameter */
	bm25K1: number;
	/** BM25 b parameter */
	bm25B: number;
	/** Default chunk size in lines */
	defaultChunkLines: number;
	/** Maximum chunk size in lines */
	maxChunkLines: number;
	/** Maximum file size (bytes) */
	maxFileSize: number;
	/** Batch size for Qdrant upsert */
	batchSize: number;
	/** Encoding batch size for HTTP provider */
	encodeBatchSize: number;
	/** Maximum characters per chunk for encoding */
	maxEncodeChars: number;
	/** Path to persist BM25 vocabulary */
	vocabPath: string;
	/** Embedding server URL (HTTP provider) */
	embeddingServerUrl: string;
}

/** A code chunk with metadata. */
export interface Chunk {
	/** Text content of the chunk */
	text: string;
	/** Starting line number (1-indexed) */
	startLine: number;
	/** Ending line number (1-indexed) */
	endLine: number;
	/** Symbol name (e.g., "fn render", "class Button") */
	symbol: string;
	/** Type of chunk */
	chunkType: string;
}

/** Payload attached to each Qdrant point. */
export interface ChunkPayload {
	/** Workspace identifier */
	workspace: string;
	/** Repository name */
	repo: string;
	/** Relative path from workspace */
	repoPath: string;
	/** Relative path from repo root */
	path: string;
	/** Absolute file path */
	absPath: string;
	/** Programming language */
	language: string;
	/** Symbol name */
	symbol: string;
	/** Chunk type */
	chunkType: string;
	/** Starting line (1-indexed) */
	startLine: number;
	/** Ending line (1-indexed) */
	endLine: number;
	/** SHA-256 hash of file content */
	fileHash: string;
	/** SHA-256 hash of chunk text */
	chunkHash: string;
	/** Git branch */
	branch: string;
	/** Git commit hash */
	commit: string;
	/** ISO timestamp of last indexing */
	lastIndexed: string;
}

/** A search result from Qdrant. */
export interface SearchResult {
	/** Qdrant point ID */
	id: string | number;
	/** Combined score (RRF) */
	score: number;
	/** Payload data */
	payload: ChunkPayload;
}

/** Statistics from an indexing run. */
export interface IndexStats {
	/** Files processed */
	files: number;
	/** Chunks created */
	chunks: number;
	/** Files skipped (no chunks) */
	skipped: number;
	/** Errors encountered */
	errors: number;
}

/** Index status from Qdrant. */
export interface IndexStatus {
	/** Total points in collection */
	points: number;
	/** Indexed vector count */
	indexedVectors: number;
	/** Number of segments */
	segments: number;
	/** Vector dimension */
	vectorDim: number | string;
	/** Whether sparse vectors are enabled */
	sparseVectors: boolean;
}
