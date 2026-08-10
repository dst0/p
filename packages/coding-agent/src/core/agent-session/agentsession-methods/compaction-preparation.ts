import {
  type CompactionDetails,
  type CompactionPreparation,
  type CompactionResult,
  type CompactionSettings,
  compact as compactWithModel,
  computeFileLists,
  createStructuredSessionState,
  hasMeaningfulStructuredSessionState,
  isStructuredSessionState,
  mergeStructuredSessionState,
  renderMinimalCompactionCheckpoint,
  type StructuredSessionState,
  stubToolResultsForCompactionSummary,
} from "../../compaction/index.ts";
import type { SessionEntry } from "../../session-manager.ts";
import type { AgentSession } from "../agentsession.ts";

export function do__prepareDeterministicCompaction(
  self: AgentSession,
  preparation: CompactionPreparation,
  pathEntries: SessionEntry[],
  settings: CompactionSettings & { renderedStateMaxTokens: number },
): CompactionResult<CompactionDetails> & { state: StructuredSessionState } {
  const { readFiles, modifiedFiles } = computeFileLists(preparation.fileOps);
  const historyStubContext = stubToolResultsForCompactionSummary(preparation.messagesToSummarize);
  const turnPrefixStubContext = stubToolResultsForCompactionSummary(preparation.turnPrefixMessages);
  const stubbedToolResultPointers = [
    ...historyStubContext.stubs.map((stub) => stub.rawPointer),
    ...turnPrefixStubContext.stubs.map((stub) => stub.rawPointer),
  ];
  const stubbedToolResults = [...new Set(stubbedToolResultPointers.map((pointer) => pointer.id))];
  const toolRawTokens = historyStubContext.toolRawTokens + turnPrefixStubContext.toolRawTokens;
  const toolStubTokens = historyStubContext.toolStubTokens + turnPrefixStubContext.toolStubTokens;
  const baseState = self._getCurrentStructuredSessionState(pathEntries);
  const risks = hasMeaningfulStructuredSessionState(baseState)
    ? []
    : [
        "No structured state was available before deterministic compaction; recent raw messages carry remaining context.",
      ];
  const state = mergeStructuredSessionState(baseState, {
    codebase:
      readFiles.length > 0 || modifiedFiles.length > 0
        ? {
            touchedFiles: [
              ...readFiles.map((path) => ({
                path,
                status: "read" as const,
                summary: "Read during compacted session history.",
              })),
              ...modifiedFiles.map((path) => ({
                path,
                status: "modified" as const,
                summary: "Modified during compacted session history.",
              })),
            ],
            relevantSymbols: [],
          }
        : undefined,
    evidence: stubbedToolResultPointers.length > 0 ? { add: stubbedToolResultPointers } : undefined,
    audit: {
      lastCompactionAt: new Date().toISOString(),
      compactionCount: baseState.audit.compactionCount + 1,
      knownRisks: risks,
    },
  });
  const summary = renderMinimalCompactionCheckpoint(state, settings.renderedStateMaxTokens);
  const summaryTokens = Math.ceil(summary.length / 4);
  const afterTokens = preparation.systemPromptTokens + summaryTokens + preparation.recentRawTokens;
  const audit = {
    beforeTokens: preparation.tokensBefore,
    afterTokens,
    savedTokens: Math.max(0, preparation.tokensBefore - afterTokens),
    summaryTokens,
    renderedStateTokens: summaryTokens,
    recentRawTokens: preparation.recentRawTokens,
    toolRawTokens,
    toolStubTokens,
    droppedEntries: preparation.droppedEntryIds,
    stubbedToolResults,
    risks,
  };
  return {
    summary,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensBefore: preparation.tokensBefore,
    tokensAfter: afterTokens,
    details: {
      readFiles,
      modifiedFiles,
      audit,
      structuredState: state,
    },
    state,
  };
}

export async function do__prepareDefaultCompaction(
  self: AgentSession,
  preparation: CompactionPreparation,
  pathEntries: SessionEntry[],
  settings: CompactionSettings & { renderedStateMaxTokens: number },
  customInstructions: string | undefined,
  signal: AbortSignal | undefined,
): Promise<CompactionResult<CompactionDetails> & { state: StructuredSessionState }> {
  const deterministic = self._prepareDeterministicCompaction(preparation, pathEntries, settings);

  try {
    const authRequest = await self._getServiceAuthWithCurrentFallback(self._getServiceModelRequest());
    const modelResult = await compactWithModel(
      preparation,
      authRequest.model,
      authRequest.apiKey,
      authRequest.headers,
      customInstructions,
      signal,
      authRequest.thinkingLevel,
      self.agent.streamFn,
      (currentChunk, totalChunks) => {
        self._emit({ type: "compaction_progress", currentChunk, totalChunks });
      },
    );
    const modelDetails = modelResult.details as CompactionDetails | undefined;
    const readFiles = modelDetails?.readFiles ?? deterministic.details?.readFiles ?? [];
    const modifiedFiles = modelDetails?.modifiedFiles ?? deterministic.details?.modifiedFiles ?? [];
    const audit = modelDetails?.audit ?? deterministic.details?.audit;
    const baseState = self._getCurrentStructuredSessionState(pathEntries);
    const state =
      modelDetails?.structuredState && isStructuredSessionState(modelDetails.structuredState)
        ? modelDetails.structuredState
        : createStructuredSessionState({
            sessionId: self.sessionManager.getSessionId(),
            previous: baseState,
            summary: modelResult.summary,
            entries: pathEntries,
            readFiles,
            modifiedFiles,
            audit,
            timestamp: new Date().toISOString(),
          });
    return {
      ...modelResult,
      details: {
        readFiles,
        modifiedFiles,
        audit,
        markdownSummary: modelDetails?.markdownSummary ?? modelResult.summary,
        structuredState: state,
      },
      state,
    };
  } catch {
    return deterministic;
  }
}
