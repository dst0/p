export interface ProjectMemoryInitResult {
  root: string;
  created: string[];
  existing: string[];
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
