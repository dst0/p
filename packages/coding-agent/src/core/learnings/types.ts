export interface LearningEntry {
  timestamp: string;
  trap: string;
  fix: string;
  rule: string;
  tags: string[];
  project?: string;
  cwd?: string;
}

export interface LearningQueryCriteria {
  queryText?: string;
  tags?: string[];
  limit?: number;
}

export interface LearningMatch {
  entry: LearningEntry;
  score: number;
  matchedTags: string[];
}
