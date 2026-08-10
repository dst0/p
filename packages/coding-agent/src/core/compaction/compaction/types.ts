import type { AgentMessage } from "@dst0/p-agent-core";
import type { StructuredSessionState } from "../structured-state.ts";
import type { FileOperations } from "../utils.ts";

export interface CompactionAudit {
  beforeTokens: number;
  afterTokens: number;
  savedTokens: number;
  summaryTokens: number;
  renderedStateTokens: number;
  recentRawTokens: number;
  toolRawTokens: number;
  toolStubTokens: number;
  droppedEntries: string[];
  stubbedToolResults: string[];
  risks: string[];
}

export type EvidenceKind = "message" | "tool_result" | "bash" | "file" | "web" | "artifact";

export interface EvidencePointer {
  id: string;
  kind: EvidenceKind;
  entryId?: string;
  path?: string;
  summary: string;
  retrieveWhen: string;
}

export interface ToolResultStub {
  toolCallId: string;
  toolName: string;
  status: "success" | "error";
  exitCode?: number;
  summary: string;
  keyLines: string[];
  artifactIds: string[];
  rawPointer: EvidencePointer;
  tokenSavingsEstimate: number;
}

export interface ToolResultStubbingResult {
  messages: AgentMessage[];
  stubs: ToolResultStub[];
  toolRawTokens: number;
  toolStubTokens: number;
  tokenSavingsEstimate: number;
}

export interface CompactionDetails {
  readFiles: string[];
  modifiedFiles: string[];
  audit?: CompactionAudit;
  markdownSummary?: string;
  structuredState?: StructuredSessionState;
}

export interface CompactionResult<T = unknown> {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  /** Estimated token count after compaction. */
  tokensAfter?: number;
  /** Extension-specific data (e.g., ArtifactIndex, version markers for structured compaction) */
  details?: T;
}

export interface CompactionSettings {
  enabled: boolean;
  /** @deprecated Use triggerReserveTokens. */
  reserveTokens?: number;
  /** @deprecated Use keepRecentMinTokens/keepRecentMaxTokens. */
  keepRecentTokens?: number;
  triggerReserveTokens?: number;
  triggerRatio?: number;
  keepRecentMinTokens?: number;
  keepRecentMaxTokens?: number;
  summaryMaxTokens?: number;
  renderedStateMaxTokens?: number;
  targetContextTokens?: number;
}

export interface ResolvedCompactionSettings {
  enabled: boolean;
  triggerReserveTokens: number;
  triggerRatio?: number;
  keepRecentMinTokens: number;
  keepRecentMaxTokens: number;
  summaryMaxTokens: number;
  renderedStateMaxTokens: number;
  targetContextTokens: number;
}

export interface ContextUsageEstimate {
  tokens: number;
  usageTokens: number;
  trailingTokens: number;
  lastUsageIndex: number | null;
  staticTokens: number;
}

export interface ContextUsageEstimateOptions {
  useProviderUsage?: boolean;
  sinceTimestamp?: number;
}

export interface ContextBudgetReport {
  contextTokens: number;
  contextWindow: number;
  triggerThreshold: number;
  triggerReserveTokens: number;
  triggerRatio?: number;
  targetContextTokens: number;
  remainingTokens: number;
  shouldCompact: boolean;
}

export interface CutPointResult {
  /** Index of first entry to keep */
  firstKeptEntryIndex: number;
  /** Index of user message that starts the turn being split, or -1 if not splitting */
  turnStartIndex: number;
  /** Whether this cut splits a turn (cut point is not a user message) */
  isSplitTurn: boolean;
}

export interface CompactionPreparation {
  /** UUID of first entry to keep */
  firstKeptEntryId: string;
  /** Messages that will be summarized and discarded */
  messagesToSummarize: AgentMessage[];
  /** Messages that will be turned into turn prefix summary (if splitting) */
  turnPrefixMessages: AgentMessage[];
  /** Whether this is a split turn (cut point in middle of turn) */
  isSplitTurn: boolean;
  tokensBefore: number;
  /** Summary from previous compaction, for iterative update */
  previousSummary?: string;
  /** File operations extracted from messagesToSummarize */
  fileOps: FileOperations;
  /** Compaction settions from settings.jsonl	*/
  settings: CompactionSettings;
  /** Adaptive recent-token budget selected for this compaction run. */
  keepRecentTokens: number;
  /** Tokens estimated for history that will be summarized. */
  tokensToSummarize: number;
  /** Tokens estimated for raw entries kept after the compaction boundary. */
  recentRawTokens: number;
  /** Entry ids that are replaced by the summary. */
  droppedEntryIds: string[];
  /** Estimated tokens from static prompt context. */
  systemPromptTokens: number;
}

export type CompactionPreparationResult =
  | { ok: true; preparation: CompactionPreparation }
  | {
      ok: false;
      message: string;
      reason: string;
      tokensToSummarize?: number;
      tokensBefore?: number;
    };
