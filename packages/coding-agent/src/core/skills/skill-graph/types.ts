export type SkillNodeType = "skill" | "protocol" | "language" | "framework" | "version" | "domain" | "reference";

export type SkillEdgeType = "contains" | "specializes" | "version_of" | "references" | "depends_on";

export interface SkillGraphMetadata {
  language?: string;
  framework?: string;
  version?: string;
  isDefaultVersion?: boolean;
  tags?: string[];
  triggers?: string[];
}

export interface SkillGraphNodeData {
  id: string;
  name: string;
  type: SkillNodeType;
  title: string;
  description: string;
  filePath: string;
  metadata: SkillGraphMetadata;
}

export interface SkillGraphEdge {
  from: string;
  to: string;
  type: SkillEdgeType;
  metadata?: Record<string, unknown>;
}

export interface SkillQueryCriteria {
  language?: string;
  framework?: string;
  version?: string;
  topics?: string[];
  queryText?: string;
  types?: SkillNodeType[];
  limit?: number;
}

export interface SkillGraphMatch {
  node: SkillGraphNodeData;
  score: number;
  matchedReasons: string[];
}
