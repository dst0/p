/**
 * Compaction and summarization utilities.
 */

export * from "./branch-summarization.ts";
export * from "./compaction.ts";
export {
  type CompactionPreparation,
  type CompactionPreparationResult,
  compact,
  prepareCompaction,
  renderMinimalCompactionCheckpoint,
  selectKeepRecentTokensForTarget,
  truncateKeptMessages,
} from "./minimal-compaction.ts";
export {
  createLiveStructuredSessionState,
  createStructuredSessionState,
  getLatestStructuredSessionState,
  hasMeaningfulStructuredSessionState,
  mergeStructuredSessionState,
  renderStructuredSessionCheckpoint,
  renderWorkingSessionState,
  sanitizeStructuredSessionState,
} from "./session-state-risk-filter.ts";
export type { EvidenceKind } from "./structured-state.ts";
export * from "./structured-state.ts";
export * from "./utils.ts";
