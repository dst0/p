import {
  createInitialStructuredSessionState,
  findMatchingPlanItem,
  getLatestStructuredSessionState,
  mergeStructuredSessionState,
  STRUCTURED_SESSION_STATE_CUSTOM_TYPE,
  type StatePatch,
} from "../../compaction/index.ts";
import type { ToolDefinition } from "../../extensions/index.ts";
import type { AgentSession } from "../agentsession.ts";
import { SESSION_RECALL_SCHEMA, TOOL_SEARCH_SCHEMA, TOOL_SEARCH_TOOL_NAME } from "../constants.ts";
import { capStateToolText } from "../message-utils.ts";
import { formatRecallResult } from "../recall-utils.ts";
import type { SessionRecallInput, ToolSearchResult } from "../session-types.ts";
import type { MarkSessionProgressInput, MarkSessionProgressResult, RecallResult } from "../state-types.ts";

export function do__applyMarkSessionProgress(
  self: AgentSession,
  input: MarkSessionProgressInput,
): MarkSessionProgressResult {
  const task = capStateToolText(input.task, 280);
  const branchEntries = self.sessionManager.getBranch();
  const previous =
    getLatestStructuredSessionState(branchEntries) ??
    createInitialStructuredSessionState(self.sessionManager.getSessionId());
  const matchedPlanItem = findMatchingPlanItem(previous.plan, task);
  if (!task || !matchedPlanItem) {
    return {
      status: "not_found",
      task,
      goal: previous.canonicalRequest.current,
      planItems: previous.plan.length,
      toolCalls: self.getSessionStats().toolCalls,
    };
  }

  const sourceEntryIds = branchEntries.map((entry) => entry.id).filter((id) => id.length > 0);
  const patch: StatePatch = {
    plan: {
      update: [
        {
          id: matchedPlanItem.id,
          matchText: task,
          status: input.status,
          evidenceEntryIds: sourceEntryIds,
        },
      ],
    },
  };
  const state = mergeStructuredSessionState(previous, patch);
  self.sessionManager.appendCustomEntry(STRUCTURED_SESSION_STATE_CUSTOM_TYPE, state);
  return {
    status: "updated",
    task,
    matchedTask: matchedPlanItem.text,
    goal: state.canonicalRequest.current,
    planItems: state.plan.length,
    toolCalls: self.getSessionStats().toolCalls,
  };
}

export function do__createSessionRecallToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof SESSION_RECALL_SCHEMA, RecallResult> {
  return {
    name: "session_recall",
    label: "Session Recall",
    description:
      "Retrieve bounded snippets from older session history by pointer id or query. Use this when tool results were stubbed or exact old evidence is needed.",
    promptSnippet:
      "session_recall(query, options): retrieve bounded snippets from old session history by pointer id or search query. For stubbed tool output, use { includeRaw: true, maxTokens: 4000 }.",
    promptGuidelines: [
      "When a tool result is stubbed, call session_recall with its raw pointer and { includeRaw: true, maxTokens: 4000 } before rereading the same file or relying on omitted raw output.",
    ],
    parameters: SESSION_RECALL_SCHEMA,
    executionMode: "parallel",
    execute: async (_toolCallId, params) => {
      const result = self._recallSessionEvidence(params as SessionRecallInput);
      return {
        content: [{ type: "text", text: formatRecallResult(result) }],
        details: result,
      };
    },
  };
}

export function do__createToolSearchToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof TOOL_SEARCH_SCHEMA, ToolSearchResult> {
  return {
    name: TOOL_SEARCH_TOOL_NAME,
    label: "Tool Search",
    description:
      "Search registered extension and MCP tools by capability and activate a small relevant set for the next turn. " +
      "Use this before browser, external-service, language-server, memory, or other specialized work when the needed tool is not already available.",
    promptSnippet:
      "tool_search(query, names?, limit?): find and activate relevant extension or MCP tools without loading every tool schema",
    promptGuidelines: [
      "When specialized tools are needed but not active, call tool_search with a specific capability, then use the activated tools on the next turn.",
    ],
    parameters: TOOL_SEARCH_SCHEMA,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const query = params.query?.trim();
      const requestedNames = [...new Set(params.names ?? [])].slice(0, 8);
      const activeNames = new Set(self.getActiveToolNames());
      const alreadyActive = requestedNames.filter((name) => activeNames.has(name));
      const unknownNames = requestedNames.filter((name) => !self._toolDefinitions.has(name));
      const exactMatches = requestedNames.filter((name) => self._toolDefinitions.has(name) && !activeNames.has(name));
      const limit = Math.min(8, Math.max(1, params.limit ?? 5));
      const terms = query
        ?.toLowerCase()
        .split(/[^a-z0-9_]+/u)
        .filter((term) => term.length >= 2);
      const compactQuery = terms?.join("") ?? "";
      const rankedMatches = query
        ? Array.from(self._toolDefinitions.entries())
            .filter(([name, entry]) => !activeNames.has(name) && entry.sourceInfo.source !== "builtin")
            .map(([name, entry]) => {
              const normalizedName = name.toLowerCase();
              const normalizedLabel = entry.definition.label.toLowerCase();
              const normalizedDescription = entry.definition.description.toLowerCase();
              const normalizedSnippet = entry.definition.promptSnippet?.toLowerCase() ?? "";
              const normalizedSource = entry.sourceInfo.path.toLowerCase();
              let score = normalizedName === query.toLowerCase() ? 1_000 : 0;
              if (compactQuery.length >= 3 && normalizedName.replace(/[^a-z0-9]/gu, "").includes(compactQuery)) {
                score += 150;
              }
              for (const term of terms ?? []) {
                if (normalizedName.includes(term)) score += 20;
                if (normalizedLabel.includes(term)) score += 10;
                if (normalizedDescription.includes(term)) score += 5;
                if (normalizedSnippet.includes(term)) score += 3;
                if (normalizedSource.includes(term)) score += 3;
              }
              return { name, entry, score };
            })
            .filter(({ score }) => score > 0)
            .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
            .slice(0, limit)
        : [];
      const queryMatches = rankedMatches.map(({ name }) => name);
      const activated = [...new Set([...exactMatches, ...queryMatches])].slice(0, 8);
      if (activated.length > 0) {
        self.setActiveToolsByName([...activeNames, ...activated]);
      }
      const matches = activated.map((name) => {
        const entry = self._toolDefinitions.get(name)!;
        return {
          name,
          description: entry.definition.description,
          source: entry.sourceInfo.path,
        };
      });
      const result: ToolSearchResult = {
        query,
        activated,
        alreadyActive,
        matches,
        unknownNames,
      };
      const lines = matches.map((match) => `- ${match.name}: ${match.description}`);
      const summary =
        lines.length > 0
          ? `Activated for the next turn:\n${lines.join("\n")}`
          : "No matching inactive tools were found. Use a more specific capability or exact tool names.";
      return {
        content: [{ type: "text", text: summary }],
        details: result,
      };
    },
  };
}
