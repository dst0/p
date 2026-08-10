import type { StructuredSessionState } from "../compaction/index.ts";
import type { ContextUsage } from "../extensions/types.ts";

export interface ProjectMemorySnapshot {
  version: number;
  updatedAt: string;
  sessionId: string;
  checkpoint: string;
  state?: StructuredSessionState;
  contextUsage?: Pick<
    ContextUsage,
    "tokens" | "contextWindow" | "triggerThreshold" | "targetContextTokens" | "shouldCompact" | "toolRawTokens"
  >;
}

export interface ProjectMemoryInitResult {
  root: string;
  created: string[];
  existing: string[];
}

export interface ProjectMemoryUpdateInput {
  cwd: string;
  sessionId: string;
  checkpoint: string;
  state?: StructuredSessionState;
  contextUsage?: ContextUsage;
}

export interface ProjectMemoryUpdateResult {
  path: string;
  created: boolean;
  managedFiles: string[];
}

export interface ProjectMemoryDiffInput extends ProjectMemoryUpdateInput {}

export interface ProjectMemoryDiffResult {
  status: "missing" | "same" | "changed";
  path: string;
  lines: string[];
}

export interface ProjectMemorySearchResult {
  query: string;
  hits: Array<{
    path: string;
    line: number;
    excerpt: string;
    score: number;
  }>;
}

export interface ProjectMemoryPinResult {
  id: string;
  path: string;
}

export interface ProjectMemoryForgetResult {
  id: string;
  removed: number;
  files: string[];
}

export interface ProjectMemoryContextResult {
  query: string;
  content: string;
  hits: ProjectMemorySearchResult["hits"];
}
