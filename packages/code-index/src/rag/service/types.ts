import type { ScannedFile } from "../file-preparation-core.ts";
import type { ManifestFileEntry, StoredChunkPayload } from "../types.ts";

export interface PreparedChunk {
  id: string;
  retrievalText: string;
  payload: StoredChunkPayload;
}

export interface PreparedFile {
  file: ScannedFile;
  entry: ManifestFileEntry;
  chunks: PreparedChunk[];
}

export interface RefreshPlan {
  added: ScannedFile[];
  changed: ScannedFile[];
  deleted: Array<{ path: string; entry: ManifestFileEntry }>;
  unchanged: ScannedFile[];
}

export interface NormalizedSearchInput {
  query: string;
  limit: number;
  pathPrefix?: string;
  languages?: string[];
  symbolTypes?: string[];
  includeTests: boolean;
  includeGenerated: boolean;
  freshness: "allow_stale" | "prefer_fresh" | "require_fresh";
}
