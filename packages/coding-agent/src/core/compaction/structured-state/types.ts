import type { SessionEntry } from "../../session-manager.ts";
import type { CompactionAudit, EvidencePointer } from "../compaction.ts";

export type ConstraintSource = "user" | "system" | "project" | "inferred";

export type ConstraintStatus = "active" | "superseded" | "rejected";

export type ConstraintEnforceability = "prompt" | "runtime_check" | "test" | "manual";

export type PlanStatus = "not_started" | "in_progress" | "done" | "failed" | "blocked";

export type FileTouchStatus = "read" | "modified" | "created" | "deleted";

export type EvidenceKind = EvidencePointer["kind"];

export interface Constraint {
  id: string;
  text: string;
  source: ConstraintSource;
  status: ConstraintStatus;
  enforceability: ConstraintEnforceability;
}

export interface PlanItem {
  id: string;
  text: string;
  status: PlanStatus;
  parentId?: string;
  evidenceEntryIds: string[];
}

export interface Decision {
  id: string;
  decision: string;
  rationale: string;
  evidencePointers: EvidencePointer[];
  status: "active" | "superseded";
}

export interface TouchedFile {
  path: string;
  status: FileTouchStatus;
  summary: string;
}

export interface RelevantSymbol {
  name: string;
  file: string;
  reason: string;
}

export interface OriginalUserRequest {
  id: string;
  entryId: string;
  timestamp: string;
  kind: "request" | "correction" | "follow_up";
  text: string;
  summary: string;
}

export interface StructuredSessionState {
  version: number;
  sessionId: string;
  canonicalRequest: {
    current: string;
    sourceEntryIds: string[];
    originalRequests: OriginalUserRequest[];
    superseded: Array<{
      old: string;
      replacedBy: string;
      reason: string;
      entryId: string;
    }>;
  };
  constraints: Constraint[];
  plan: PlanItem[];
  decisions: Decision[];
  codebase: {
    touchedFiles: TouchedFile[];
    relevantSymbols: RelevantSymbol[];
  };
  evidence: EvidencePointer[];
  audit: {
    lastCompactionAt: string;
    compactionCount: number;
    knownRisks: string[];
  };
}

export interface StatePatch {
  canonicalRequest?: Partial<StructuredSessionState["canonicalRequest"]>;
  constraints?: {
    add?: Constraint[];
    update?: Array<{ id: string; patch: Partial<Constraint> }>;
  };
  plan?: {
    replace?: PlanItem[];
    add?: PlanItem[];
    update?: Array<{
      id: string;
      matchText?: string;
      status?: PlanStatus;
      text?: string;
      parentId?: string;
      evidenceEntryIds?: string[];
    }>;
    remove?: Array<string | { id?: string; text: string }>;
  };
  decisions?: {
    add?: Decision[];
    supersede?: Array<{ id: string; reason: string }>;
  };
  codebase?: Partial<StructuredSessionState["codebase"]>;
  evidence?: {
    add?: EvidencePointer[];
  };
  audit?: Partial<StructuredSessionState["audit"]>;
}

export interface ParsedSessionStateUpdateBlock {
  strippedText: string;
  patch?: StatePatch;
  malformed: boolean;
  error?: string;
}

export interface StructuredStateUpdateInput {
  sessionId: string;
  previous?: StructuredSessionState;
  summary: string;
  entries: SessionEntry[];
  readFiles?: string[];
  modifiedFiles?: string[];
  audit?: CompactionAudit;
  timestamp?: string;
}

export interface LiveStructuredStateInput {
  sessionId: string;
  previous?: StructuredSessionState;
  entries: SessionEntry[];
  timestamp?: string;
}

export interface OrderedPlanItem {
  item: PlanItem;
  depth: number;
  isLastChild: boolean;
  active: boolean;
}
