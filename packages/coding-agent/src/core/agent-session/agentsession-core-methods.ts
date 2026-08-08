import type { AgentEvent, AgentMessage, CompletionMode, ThinkingLevel } from "@dst0/p-agent-core";
import type { AssistantMessage, ImageContent, Message, Model, TextContent } from "@dst0/p-ai";
import type { StructuredSessionState } from "../compaction/index.ts";
import type { ToolDefinition, ToolInfo } from "../extensions/index.ts";
import type { CustomMessage } from "../messages.ts";
import type { SessionEntry } from "../session-manager.ts";
import type { TokenBreakdown } from "../token-accounting.ts";
import type {
  AgentSessionEvent,
  AgentSessionEventListener,
  ModelCycleResult,
  PromptOptions,
  SessionStateSnapshot,
} from "./session-types.ts";
import type { RuntimeContextPrompts, ToolResultContextExtract } from "./state-types.ts";

export interface AgentSessionCoreMethods {
  _getRequiredRequestAuth(model: Model<any>): Promise<{
    apiKey: string;
    headers?: Record<string, string>;
  }>;
  _getCompactionRequestAuth(model: Model<any>): Promise<{
    apiKey?: string;
    headers?: Record<string, string>;
  }>;
  _getServiceModelRequest(minContextTokens?: number): {
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
  };
  _getServiceAuthWithCurrentFallback(request: { model: Model<any>; thinkingLevel: ThinkingLevel }): Promise<{
    model: Model<any>;
    thinkingLevel: ThinkingLevel;
    apiKey?: string;
    headers?: Record<string, string>;
  }>;
  _getFastResponderModelRequest():
    | {
        model: Model<string>;
        thinkingLevel: ThinkingLevel;
      }
    | undefined;
  _shouldRunFastResponder(messages: AgentMessage[]): boolean;
  _createFastResponderMessage(
    userText: string,
    messages: AgentMessage[],
  ): Promise<
    | CustomMessage<{
        model: string;
        contextTokens: number;
      }>
    | undefined
  >;
  _maybeCreateToolResultContextExtract(
    toolName: string,
    content: (TextContent | ImageContent)[],
    details: unknown,
    isError: boolean,
    contextMessages: AgentMessage[],
    signal?: AbortSignal,
  ): Promise<ToolResultContextExtract | undefined>;
  _installAgentToolHooks(): void;
  _getFinishWorkSessionStateBlockReason(args: unknown): string | undefined;
  _emit(event: AgentSessionEvent): void;
  _emitQueueUpdate(): void;
  _willRetryAfterAgentEnd(
    event: Extract<
      AgentEvent,
      {
        type: "agent_end";
      }
    >,
  ): boolean;
  _isContextOverflowForCurrentModel(message: AssistantMessage): boolean;
  _removeContextOverflowMessages(messages: AgentMessage[]): AgentMessage[];
  _shouldHideContextOverflowMessage(message: AssistantMessage): boolean;
  _getUserMessageText(message: Message): string;
  _findLastAssistantMessage(): AssistantMessage | undefined;
  _replaceMessageInPlace(target: AgentMessage, replacement: AgentMessage): void;
  _getAssistantMessageText(message: AssistantMessage): string;
  _replaceAssistantMessageText(message: AssistantMessage, text: string): AssistantMessage;
  _applyAssistantSessionStateUpdate(rawAssistantText: string, sourceEntryId: string): void;
  _emitExtensionEvent(event: AgentEvent): Promise<void>;
  subscribe(listener: AgentSessionEventListener): () => void;
  _disconnectFromAgent(): void;
  _reconnectToAgent(): void;
  dispose(): void;
  getLastTokenBreakdown(): TokenBreakdown | undefined;
  willRetryMessage(message: AssistantMessage): boolean;
  getActiveToolNames(): string[];
  getAllTools(): ToolInfo[];
  getToolDefinition(name: string): ToolDefinition | undefined;
  setActiveToolsByName(toolNames: string[]): void;
  enablePlanMode(): {
    enabled: boolean;
    missingTools: string[];
  };
  disablePlanMode(): void;
  setScopedModels(
    scopedModels: Array<{
      model: Model<any>;
      thinkingLevel?: ThinkingLevel;
    }>,
  ): void;
  _normalizePromptSnippet(text: string | undefined): string | undefined;
  _normalizePromptGuidelines(guidelines: string[] | undefined): string[];
  _getEffectiveCompletionModeForActiveTools(activeToolCount: number): CompletionMode;
  _getInteractionModeSystemPrompt(): string | undefined;
  _rebuildSystemPrompt(toolNames: string[], completionMode?: CompletionMode): string;
  _runAgentPrompt(messages: AgentMessage | AgentMessage[]): Promise<void>;
  _handlePostAgentRun(): Promise<boolean>;
  prompt(text: string, options?: PromptOptions): Promise<void>;
  _tryExecuteExtensionCommand(text: string): Promise<boolean>;
  _expandSkillCommand(text: string): string;
  steer(text: string, images?: ImageContent[]): Promise<void>;
  followUp(text: string, images?: ImageContent[]): Promise<void>;
  _queueSteer(text: string, images?: ImageContent[]): Promise<void>;
  _queueFollowUp(text: string, images?: ImageContent[]): Promise<void>;
  _throwIfExtensionCommand(text: string): void;
  sendCustomMessage<T = unknown>(
    message: Pick<CustomMessage<T>, "customType" | "content" | "display" | "details">,
    options?: {
      triggerTurn?: boolean;
      deliverAs?: "steer" | "followUp" | "nextTurn";
    },
  ): Promise<void>;
  sendUserMessage(
    content: string | (TextContent | ImageContent)[],
    options?: {
      deliverAs?: "steer" | "followUp";
    },
  ): Promise<void>;
  clearQueue(): {
    steering: string[];
    followUp: string[];
  };
  getSteeringMessages(): readonly string[];
  getFollowUpMessages(): readonly string[];
  abort(): Promise<void>;
  _emitModelSelect(
    nextModel: Model<any>,
    previousModel: Model<any> | undefined,
    source: "set" | "cycle" | "restore",
  ): Promise<void>;
  setModel(model: Model<any>): Promise<void>;
  cycleModel(direction?: "forward" | "backward"): Promise<ModelCycleResult | undefined>;
  _cycleScopedModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined>;
  _cycleAvailableModel(direction: "forward" | "backward"): Promise<ModelCycleResult | undefined>;
  setThinkingLevel(level: ThinkingLevel): void;
  cycleThinkingLevel(): ThinkingLevel | undefined;
  getAvailableThinkingLevels(): ThinkingLevel[];
  supportsThinking(): boolean;
  _getThinkingLevelForModelSwitch(explicitLevel?: ThinkingLevel): ThinkingLevel;
  _clampThinkingLevel(level: ThinkingLevel, _availableLevels: ThinkingLevel[]): ThinkingLevel;
  syncQueueModesFromSettings(): void;
  setSteeringMode(mode: "all" | "one-at-a-time"): void;
  setFollowUpMode(mode: "all" | "one-at-a-time"): void;
  getSessionStateSnapshot(): SessionStateSnapshot;
  _getCurrentStructuredSessionState(branchEntries?: SessionEntry[]): StructuredSessionState;
  _getLiveStateFallbackEntries(branchEntries: SessionEntry[]): SessionEntry[];
  _createLiveStructuredSessionState(
    branchEntries: SessionEntry[],
    previous?: StructuredSessionState,
  ): StructuredSessionState;
  _syncProjectMemory(): void;
  _createProjectMemoryPrompt(query: string): string | undefined;
  _createRuntimeContextPrompts(
    query: string,
    baseSystemPrompt: string,
    pendingMessages?: AgentMessage[],
  ): RuntimeContextPrompts;
  _withPendingMessageEntries(branchEntries: SessionEntry[], pendingMessages: AgentMessage[]): SessionEntry[];
}
