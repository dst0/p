import type { Message, SimpleStreamOptions, ThinkingBudgets, Transport } from "@dst0/p-ai";
import type { CompletionMode, CompletionProtocolLimits } from "../completion-protocol.ts";
import type { PrepareModelCallContext, PrepareModelCallResult } from "../model-call-preparation.ts";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentLoopTurnUpdate,
  AgentMessage,
  AgentState,
  BeforeToolCallContext,
  BeforeToolCallResult,
  PrepareNextTurnContext,
  QueueMode,
  StreamFn,
  ToolExecutionMode,
} from "../types.ts";

export type MutableAgentState = Omit<
  AgentState,
  "isStreaming" | "streamingMessage" | "pendingToolCalls" | "errorMessage"
> & {
  isStreaming: boolean;
  streamingMessage?: AgentMessage;
  pendingToolCalls: Set<string>;
  errorMessage?: string;
};

export interface AgentOptions {
  initialState?: Partial<Omit<AgentState, "pendingToolCalls" | "isStreaming" | "streamingMessage" | "errorMessage">>;
  convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
  transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
  streamFn?: StreamFn;
  getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
  onPayload?: SimpleStreamOptions["onPayload"];
  onResponse?: SimpleStreamOptions["onResponse"];
  beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
  afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
  prepareNextTurn?: (
    signal?: AbortSignal,
    context?: PrepareNextTurnContext,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;
  prepareModelCall?: (
    context: PrepareModelCallContext,
    signal?: AbortSignal,
  ) => Promise<PrepareModelCallResult | undefined> | PrepareModelCallResult | undefined;
  steeringMode?: QueueMode;
  followUpMode?: QueueMode;
  sessionId?: string;
  cacheRetention?: SimpleStreamOptions["cacheRetention"];
  thinkingBudgets?: ThinkingBudgets;
  transport?: Transport;
  maxRetryDelayMs?: number;
  maxTokens?: SimpleStreamOptions["maxTokens"];
  toolExecution?: ToolExecutionMode;
  completionMode?: CompletionMode;
  completionLimits?: CompletionProtocolLimits;
}

export type ActiveRun = {
  promise: Promise<void>;
  resolve: () => void;
  abortController: AbortController;
};
