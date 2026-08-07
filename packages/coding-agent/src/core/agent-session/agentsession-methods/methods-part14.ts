import {
  createContextBudgetReport,
  createInitialStructuredSessionState,
  createLiveStructuredSessionState,
  getLatestStructuredSessionState,
  mergeStructuredSessionState,
  prepareCompaction,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  stubToolResultsForCompactionSummary,
  writeSessionStateFile,
} from "../../compaction/index.ts";
import type { ToolDefinition } from "../../extensions/index.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  MARK_SESSION_PROGRESS_TOOL_NAME,
  UPDATE_SESSION_STATE_SCHEMA,
  UPDATE_SESSION_STATE_TOOL_NAME,
} from "../constants.ts";
import { isInternalCompletionProtocolRepairMessage } from "../helpers-part1.ts";
import type { CompactionDryRunResult, UpdateSessionStateInput } from "../types-part1.ts";
import type { UpdateSessionStateResult } from "../types-part2.ts";

export function do_getCompactionDryRun(self: AgentSession): CompactionDryRunResult {
  const settings = self._getEffectiveCompactionSettings();
  const contextWindow = self.model?.contextWindow ?? 0;
  const promptContext = self._preparePromptContext(self._getEffectiveCompactedMessages());
  const estimate = promptContext.estimate;
  const tokenBreakdown = self._createTokenBreakdownForPrompt(promptContext.messages, {
    source: promptContext.source,
    totalOverride: estimate.tokens,
    toolRawTokens: promptContext.toolRawTokens,
  });
  const budget = createContextBudgetReport(promptContext.budgetEstimate.tokens, contextWindow, settings);
  const pathEntries = self.sessionManager.getBranch();
  const preparationResult = prepareCompaction(pathEntries, settings, self.systemPrompt);

  if (!preparationResult.ok) {
    return {
      ok: false,
      reason: preparationResult.reason,
      message: preparationResult.message,
      contextTokens: estimate.tokens,
      contextWindow,
      triggerThreshold: budget.triggerThreshold,
      shouldCompact: budget.shouldCompact,
      tokensToSummarize: preparationResult.tokensToSummarize,
      toolRawTokens: promptContext.toolRawTokens,
      toolStubTokens: 0,
      toolStubSavings: 0,
      stubbedToolResults: [],
      tokenBreakdown,
    };
  }

  const preparation = preparationResult.preparation;
  const historyStubContext = stubToolResultsForCompactionSummary(preparation.messagesToSummarize);
  const turnPrefixStubContext = stubToolResultsForCompactionSummary(preparation.turnPrefixMessages);
  const toolRawTokens = historyStubContext.toolRawTokens + turnPrefixStubContext.toolRawTokens;
  const toolStubTokens = historyStubContext.toolStubTokens + turnPrefixStubContext.toolStubTokens;
  const stubbedToolResults = [
    ...new Set([
      ...historyStubContext.stubs.map((stub) => stub.rawPointer.id),
      ...turnPrefixStubContext.stubs.map((stub) => stub.rawPointer.id),
    ]),
  ];
  const projectedAfterTokens =
    preparation.systemPromptTokens +
    Math.min(settings.summaryMaxTokens, settings.renderedStateMaxTokens) +
    preparation.recentRawTokens;
  return {
    ok: true,
    contextTokens: estimate.tokens,
    contextWindow,
    triggerThreshold: budget.triggerThreshold,
    shouldCompact: budget.shouldCompact,
    keepRecentTokens: preparation.keepRecentTokens,
    firstKeptEntryId: preparation.firstKeptEntryId,
    tokensToSummarize: preparation.tokensToSummarize,
    recentRawTokens: preparation.recentRawTokens,
    projectedAfterTokens,
    droppedEntries: preparation.droppedEntryIds,
    toolRawTokens,
    toolStubTokens,
    toolStubSavings: Math.max(0, toolRawTokens - toolStubTokens),
    stubbedToolResults,
    tokenBreakdown,
  };
}

export function do__createUpdateSessionStateToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof UPDATE_SESSION_STATE_SCHEMA, UpdateSessionStateResult> {
  return {
    name: UPDATE_SESSION_STATE_TOOL_NAME,
    label: "Update Session State",
    description: "Record or revise the canonical goal, plan, decisions, files, and risks for the latest user message.",
    promptSnippet:
      "update_session_state(action, goal?, plan?, decisions?, risks?): call before other tools on every user turn to set the initial plan or re-plan against the latest user message.",
    promptGuidelines: [
      `Call ${UPDATE_SESSION_STATE_TOOL_NAME} before any other tool on every new user turn, including the first request and queued follow-ups.`,
      "Use it to preserve the durable goal when the latest user message is a follow-up, or to explicitly change the goal when the user corrects the objective.",
      `For action "replan", provide updated plan items. Each item can have an optional "op" field: "add" (default, adds new or updates matched existing), "update" (updates matched existing item), or "remove" (removes matched item by exact text). Items not mentioned are preserved.`,
      `To fully replace the entire plan mid-task, mark all items done then use "initial_plan".`,
      `Use "action": "progress_update" to update existing plan items (status/text) without adding new ones.`,
      `Use ${MARK_SESSION_PROGRESS_TOOL_NAME} instead when only an existing plan item changes status.`,
      "Do not wait for user approval in normal mode; self is internal state maintenance, not /plan approval mode.",
    ],
    parameters: UPDATE_SESSION_STATE_SCHEMA,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = self._applyUpdateSessionState(params as UpdateSessionStateInput);
      return {
        content: [
          {
            type: "text",
            text:
              result.status === "updated"
                ? `Session state updated. Goal: ${result.goal || "(none)"}. Plan items: ${result.planItems}.`
                : `Session state unchanged. Goal: ${result.goal || "(none)"}.`,
          },
        ],
        details: result,
      };
    },
  };
}

export function do__applyUpdateSessionState(
  self: AgentSession,
  input: UpdateSessionStateInput,
): UpdateSessionStateResult {
  const branchEntries = self.sessionManager
    .getBranch()
    .filter((entry) => entry.type !== "message" || !isInternalCompletionProtocolRepairMessage(entry.message));
  const previous =
    getLatestStructuredSessionState(branchEntries) ??
    createInitialStructuredSessionState(self.sessionManager.getSessionId());
  const liveState = createLiveStructuredSessionState({
    sessionId: self.sessionManager.getSessionId(),
    previous: createInitialStructuredSessionState(self.sessionManager.getSessionId()),
    entries: branchEntries,
    timestamp: new Date().toISOString(),
  });
  const sourceEntryIds = liveState.canonicalRequest.sourceEntryIds;
  const patch = self._createStatePatchFromUpdateSessionStateInput(input, previous, sourceEntryIds, liveState);
  if (!patch) {
    return {
      status: "unchanged",
      action: input.action,
      goal: previous.canonicalRequest.current,
      planItems: previous.plan.length,
      toolCalls: self.getSessionStats().toolCalls,
    };
  }
  const state = mergeStructuredSessionState(previous, patch);
  self.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
  writeSessionStateFile(self._cwd, state);
  return {
    status: "updated",
    action: input.action,
    goal: state.canonicalRequest.current,
    planItems: state.plan.length,
    toolCalls: self.getSessionStats().toolCalls,
  };
}
