import type { AgentMessage } from "@dst0/p-agent-core";
import type { ContextUsageEstimate, EvidencePointer, PlanStatus } from "../compaction/index.ts";

export * from "./types-part1.ts";

import type { UpdateSessionStateInput } from "./types-part1.ts";

export interface UpdateSessionStateResult {
  status: "updated" | "unchanged";
  action: UpdateSessionStateInput["action"];
  goal: string;
  planItems: number;
  toolCalls: number;
}

export interface MarkSessionProgressInput {
  task: string;
  status: PlanStatus;
}

export interface MarkSessionProgressResult {
  status: "updated" | "not_found";
  task: string;
  matchedTask?: string;
  goal: string;
  planItems: number;
  toolCalls: number;
}

export interface RecallHit {
  pointer: EvidencePointer;
  relevance: number;
  summary: string;
  excerpt?: string;
  rawTokens?: number;
  excerptTokens?: number;
  truncated?: boolean;
}

export interface RecallResult {
  query: string;
  hits: RecallHit[];
}

export interface RecallCandidate {
  pointer: EvidencePointer;
  searchText: string;
  rawText?: string;
}

export interface RuntimeContextPrompts {
  baseSystemPrompt?: string;
  stateProtocolPrompt?: string;
  workingStatePrompt?: string;
  memoryPrompt?: string;
  rulesPrompt?: string;
  repoMapPrompt?: string;
  subagentProfilesPrompt?: string;
  subagentDigestPrompt?: string;
  combinedPrompt?: string;
  turnContextPrompt?: string;
}

export interface PromptContextPreparation {
  messages: AgentMessage[];
  estimate: ContextUsageEstimate;
  budgetEstimate: ContextUsageEstimate;
  source: "provider_usage" | "estimated";
  toolRawTokens: number;
}

export interface WorkingStatePromptInsertion {
  anchorKey: string;
  content: string;
  timestamp: number;
}

export interface WorkingStatePromptInsertionOptions {
  recordWorkingState?: boolean;
  minimumAnchorTimestamp?: number;
}

export interface ToolResultContextExtract {
  summary: string;
  relevantLines: string[];
  source: "service_model" | "deterministic";
  model?: string;
  error?: string;
}
