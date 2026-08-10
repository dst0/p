import type { AgentMessage } from "@dst0/p-agent-core";
import {
  getLatestStructuredSessionState,
  hasMeaningfulStructuredSessionState,
  renderWorkingSessionState,
} from "../../compaction/index.ts";
import type { CustomMessage } from "../../messages.ts";
import { createRulesContext } from "../../project-rules.ts";
import { createRepoMapContext } from "../../repo-map.ts";
import type { SessionEntry } from "../../session-manager.ts";
import { createSubagentDigestContext, createSubagentProfilesPrompt } from "../../subagents.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
  SESSION_STATE_PROTOCOL_PROMPT,
  WORKING_STATE_PROMPT_CUSTOM_TYPE,
} from "../constants.ts";
import { getUserMessageAnchorKey } from "../recall-utils.ts";
import type { RuntimeContextPrompts, WorkingStatePromptInsertionOptions } from "../state-types.ts";

export function do__createRuntimeContextPrompts(
  self: AgentSession,
  query: string,
  baseSystemPrompt: string,
  pendingMessages: AgentMessage[] = [],
): RuntimeContextPrompts {
  const settings = self._getEffectiveCompactionSettings();
  const branchEntries = self.sessionManager.getBranch();
  const previousStructuredState = getLatestStructuredSessionState(branchEntries);
  const structuredState = previousStructuredState
    ? self._getCurrentStructuredSessionState(self._withPendingMessageEntries(branchEntries, pendingMessages))
    : undefined;
  const workingStatePrompt =
    structuredState && hasMeaningfulStructuredSessionState(structuredState)
      ? renderWorkingSessionState(structuredState, settings.renderedStateMaxTokens)
      : undefined;
  const memoryPrompt = self._createProjectMemoryPrompt(query);
  const rulesPrompt = createRulesContext(self._cwd, query);
  const repoMapPrompt = createRepoMapContext(self._cwd, query)?.content;
  const branchEntryIds = new Set(branchEntries.map((e) => e.id));
  const subagentStorageTarget = {
    sessionDir: self.sessionManager.getSessionDir(),
    sessionId: self.sessionManager.getSessionId(),
    isPersisted: self.sessionManager.isPersisted(),
  };
  const subagentDigestPrompt = createSubagentDigestContext(subagentStorageTarget, query, {
    sessionId: self.sessionManager.getSessionId(),
    validEntryIds: branchEntryIds,
  });
  const subagentProfilesPrompt = createSubagentProfilesPrompt();
  // NOTE: volatile per-turn context is NOT included in the system prompt.
  // It is persisted as hidden custom messages next to the user message that
  // selected it, so later turns replay the exact same prefix for KV cache reuse.
  const prompts = [SESSION_STATE_PROTOCOL_PROMPT, subagentProfilesPrompt].filter(
    (prompt): prompt is string => prompt !== undefined && prompt.length > 0,
  );
  const turnContextPrompts = [memoryPrompt, rulesPrompt, repoMapPrompt, subagentDigestPrompt].filter(
    (prompt): prompt is string => prompt !== undefined && prompt.length > 0,
  );
  return {
    baseSystemPrompt,
    stateProtocolPrompt: SESSION_STATE_PROTOCOL_PROMPT,
    workingStatePrompt,
    memoryPrompt,
    rulesPrompt,
    repoMapPrompt,
    subagentProfilesPrompt,
    subagentDigestPrompt,
    combinedPrompt: prompts.length > 0 ? prompts.join("\n\n") : undefined,
    turnContextPrompt: turnContextPrompts.length > 0 ? turnContextPrompts.join("\n\n") : undefined,
  };
}

export function do__withPendingMessageEntries(
  _self: AgentSession,
  branchEntries: SessionEntry[],
  pendingMessages: AgentMessage[],
): SessionEntry[] {
  if (pendingMessages.length === 0) {
    return branchEntries;
  }
  const pendingEntries: SessionEntry[] = pendingMessages.map((message, index) => ({
    type: "message",
    id: `pending:${message.timestamp}:${index}`,
    parentId: null,
    timestamp: new Date(message.timestamp).toISOString(),
    message,
  }));
  return [...branchEntries, ...pendingEntries];
}

export function do__createToolPromptAccountingText(self: AgentSession): string {
  return self.agent.state.tools
    .map((tool) => {
      const definition = self._toolDefinitions.get(tool.name)?.definition;
      const promptSnippet = self._toolPromptSnippets.get(tool.name);
      return [tool.name, definition?.description, promptSnippet].filter(Boolean).join(": ");
    })
    .join("\n");
}

export function do__installPromptContextTransform(self: AgentSession): void {
  const previousTransform = self.agent.transformContext?.bind(self.agent);
  self.agent.transformContext = async (messages: AgentMessage[], signal?: AbortSignal): Promise<AgentMessage[]> => {
    const transformed = previousTransform ? await previousTransform(messages, signal) : messages;
    return self._preparePromptContext(transformed, self.systemPrompt, { recordWorkingState: true }).messages;
  };
}

export function do__createWorkingStatePromptMessage(
  _self: AgentSession,
  content: string,
  timestamp: number,
): CustomMessage {
  return {
    role: "custom",
    customType: WORKING_STATE_PROMPT_CUSTOM_TYPE,
    content,
    display: false,
    timestamp,
  };
}

export function do__createRuntimeContextPromptMessage(
  _self: AgentSession,
  content: string,
  timestamp: number,
): CustomMessage {
  return {
    role: "custom",
    customType: RUNTIME_CONTEXT_PROMPT_CUSTOM_TYPE,
    content,
    display: false,
    timestamp,
  };
}

export function do__withWorkingStatePromptInsertions(
  self: AgentSession,
  messages: AgentMessage[],
  workingStatePrompt: string | undefined,
  options: WorkingStatePromptInsertionOptions = {},
): AgentMessage[] {
  const validAnchorKeys = new Set<string>();
  const persistedInsertionAnchorKeys = new Set<string>();
  let currentAnchorKey: string | undefined;
  let latestUserAnchorKey: string | undefined;
  for (const message of messages) {
    if (options.minimumAnchorTimestamp !== undefined && message.timestamp < options.minimumAnchorTimestamp) {
      continue;
    }
    const anchorKey = getUserMessageAnchorKey(message);
    if (anchorKey) {
      validAnchorKeys.add(anchorKey);
      latestUserAnchorKey = anchorKey;
      currentAnchorKey = anchorKey;
      continue;
    }
    if (currentAnchorKey && message.role === "custom" && message.customType === WORKING_STATE_PROMPT_CUSTOM_TYPE) {
      persistedInsertionAnchorKeys.add(currentAnchorKey);
    }
  }

  const sourceInsertions = options.recordWorkingState
    ? self._workingStatePromptInsertions.filter((insertion) => validAnchorKeys.has(insertion.anchorKey))
    : self._workingStatePromptInsertions;
  if (options.recordWorkingState) {
    self._workingStatePromptInsertions = sourceInsertions;
  }

  const insertionsByAnchor = new Map(sourceInsertions.map((insertion) => [insertion.anchorKey, insertion] as const));
  if (
    latestUserAnchorKey &&
    workingStatePrompt &&
    !insertionsByAnchor.has(latestUserAnchorKey) &&
    !persistedInsertionAnchorKeys.has(latestUserAnchorKey)
  ) {
    const insertion = {
      anchorKey: latestUserAnchorKey,
      content: workingStatePrompt,
      timestamp: Date.now(),
    };
    insertionsByAnchor.set(latestUserAnchorKey, insertion);
    if (options.recordWorkingState) {
      self._workingStatePromptInsertions.push(insertion);
    }
  }

  if (insertionsByAnchor.size === 0) {
    return messages;
  }

  const withInsertions: AgentMessage[] = [];
  for (const message of messages) {
    withInsertions.push(message);
    const anchorKey = getUserMessageAnchorKey(message);
    const insertion = anchorKey ? insertionsByAnchor.get(anchorKey) : undefined;
    if (insertion) {
      withInsertions.push(self._createWorkingStatePromptMessage(insertion.content, insertion.timestamp));
    }
  }
  return withInsertions;
}
