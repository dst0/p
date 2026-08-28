export interface StoredChunkPayload {
  repoId: string;
  fileId: string;
  path: string;
  language: string;
  symbolName: string;
  symbolType: string;
  startLine: number;
  endLine: number;
  fileHash: string;
  chunkHash: string;
  chunkOrdinal: number;
  chunkerVersion: string;
  indexGeneration: string;
  isTest: boolean;
  isGenerated: boolean;
  content: string;
  indexedAt: string;
}

export interface SparseVector {
  indices: number[];
  values: number[];
}

export interface VectorPoint {
  id: string;
  vectors: {
    dense?: number[];
    sparse: SparseVector;
  };
  payload: StoredChunkPayload;
}

export interface StoredVectorPoint {
  id: string;
  dense?: number[];
  payload: StoredChunkPayload;
}

export interface VectorSearchFilters {
  repoId: string;
  languages?: string[];
  includeTests: boolean;
  includeGenerated: boolean;
}

export interface VectorSearchResult {
  id: string | number;
  score: number;
  payload: StoredChunkPayload;
}

export interface RagVectorStore {
  collectionExists(collection: string): Promise<boolean>;
  createCollection(collection: string, denseDimensions: number): Promise<void>;
  createPayloadIndexes?(collection: string): Promise<void>;
  deleteCollection(collection: string): Promise<void>;
  collectionStatus(collection: string): Promise<{ points: number; dimensions: number | undefined }>;
  upsert(collection: string, points: VectorPoint[]): Promise<void>;
  deleteFileVersions(collection: string, repoId: string, fileId: string, keepFileHash?: string): Promise<void>;
  iteratePoints?(
    collection: string,
    repoId: string,
    withDense: boolean,
    signal?: AbortSignal,
  ): AsyncIterable<StoredVectorPoint>;
  search(
    collection: string,
    dense: Float32Array,
    sparse: SparseVector,
    filters: VectorSearchFilters,
    limit: number,
  ): Promise<VectorSearchResult[]>;
  dispose?(): Promise<void> | void;
}
