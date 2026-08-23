import {
  type ImageContent,
  type Message,
  type SimpleStreamOptions,
  streamSimple,
  type ThinkingBudgets,
  type Transport,
} from "@dst0/p-ai";
import type { CompletionMode, CompletionProtocolLimits } from "../completion-protocol.ts";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
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
import {
  do_createLoopConfig,
  do_finishRun,
  do_handleRunFailure,
  do_processEvents,
  do_runWithLifecycle,
} from "./agent-methods/configuration.ts";
import {
  do_abort,
  do_clearAllQueues,
  do_clearFollowUpQueue,
  do_clearSteeringQueue,
  do_continue,
  do_createContextSnapshot,
  do_followUp,
  do_hasQueuedMessages,
  do_normalizePromptInput,
  do_prompt,
  do_reset,
  do_runContinuation,
  do_runPromptMessages,
  do_steer,
  do_subscribe,
  do_waitForIdle,
} from "./agent-methods/lifecycle.ts";
import { createMutableAgentState, defaultConvertToLlm } from "./helpers.ts";
import { PendingMessageQueue } from "./pendingmessagequeue.ts";
import type { ActiveRun, AgentOptions, MutableAgentState } from "./types.ts";

export class Agent {
  public _state: MutableAgentState;

  public readonly listeners = new Set<(event: AgentEvent, signal: AbortSignal) => Promise<void> | void>();

  public readonly steeringQueue: PendingMessageQueue;

  public readonly followUpQueue: PendingMessageQueue;

  public convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;

  public transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;

  public streamFn: StreamFn;

  public getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;

  public onPayload?: SimpleStreamOptions["onPayload"];

  public onResponse?: SimpleStreamOptions["onResponse"];

  public beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;

  public afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;

  public prepareNextTurn?: (
    signal?: AbortSignal,
    context?: PrepareNextTurnContext,
  ) => Promise<AgentLoopTurnUpdate | undefined> | AgentLoopTurnUpdate | undefined;

  public activeRun?: ActiveRun;

  public sessionId?: string;

  public cacheRetention: SimpleStreamOptions["cacheRetention"];

  public thinkingBudgets?: ThinkingBudgets;

  public transport: Transport;

  public maxRetryDelayMs?: number;

  public toolExecution: ToolExecutionMode;

  public completionMode: CompletionMode;

  public completionLimits?: CompletionProtocolLimits;

  constructor(options: AgentOptions = {}) {
    this._state = createMutableAgentState(options.initialState);
    this.convertToLlm = options.convertToLlm ?? defaultConvertToLlm;
    this.transformContext = options.transformContext;
    this.streamFn = options.streamFn ?? streamSimple;
    this.getApiKey = options.getApiKey;
    this.onPayload = options.onPayload;
    this.onResponse = options.onResponse;
    this.beforeToolCall = options.beforeToolCall;
    this.afterToolCall = options.afterToolCall;
    this.prepareNextTurn = options.prepareNextTurn;
    this.steeringQueue = new PendingMessageQueue(options.steeringMode ?? "one-at-a-time");
    this.followUpQueue = new PendingMessageQueue(options.followUpMode ?? "one-at-a-time");
    this.sessionId = options.sessionId;
    this.cacheRetention = options.cacheRetention ?? "long";
    this.thinkingBudgets = options.thinkingBudgets;
    this.transport = options.transport ?? "auto";
    this.maxRetryDelayMs = options.maxRetryDelayMs;
    this.toolExecution = options.toolExecution ?? "parallel";
    this.completionMode = options.completionMode ?? "explicit_finish";
    this.completionLimits = options.completionLimits;
  }

  get state(): AgentState {
    return this._state;
  }

  set steeringMode(mode: QueueMode) {
    this.steeringQueue.mode = mode;
  }

  get steeringMode(): QueueMode {
    return this.steeringQueue.mode;
  }

  set followUpMode(mode: QueueMode) {
    this.followUpQueue.mode = mode;
  }

  get followUpMode(): QueueMode {
    return this.followUpQueue.mode;
  }

  get signal(): AbortSignal | undefined {
    return this.activeRun?.abortController.signal;
  }

  subscribe(listener: (event: AgentEvent, signal: AbortSignal) => Promise<void> | void): () => void {
    return do_subscribe(this, listener);
  }

  steer(message: AgentMessage | readonly AgentMessage[]): void {
    do_steer(this, message);
  }

  followUp(message: AgentMessage | readonly AgentMessage[]): void {
    do_followUp(this, message);
  }

  clearSteeringQueue(): void {
    do_clearSteeringQueue(this);
  }

  clearFollowUpQueue(): void {
    do_clearFollowUpQueue(this);
  }

  clearAllQueues(): void {
    do_clearAllQueues(this);
  }

  hasQueuedMessages(): boolean {
    return do_hasQueuedMessages(this);
  }

  abort(): void {
    do_abort(this);
  }

  waitForIdle(): Promise<void> {
    return do_waitForIdle(this);
  }

  reset(): void {
    do_reset(this);
  }

  async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
  async prompt(input: string, images?: ImageContent[]): Promise<void>;
  async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): Promise<void> {
    return do_prompt(this, input, images);
  }

  async continue(): Promise<void> {
    return do_continue(this);
  }

  normalizePromptInput(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]): AgentMessage[] {
    return do_normalizePromptInput(this, input, images);
  }

  async runPromptMessages(
    messages: AgentMessage[],
    options: { skipInitialSteeringPoll?: boolean } = {},
  ): Promise<void> {
    return do_runPromptMessages(this, messages, options);
  }

  async runContinuation(): Promise<void> {
    return do_runContinuation(this);
  }

  createContextSnapshot(): AgentContext {
    return do_createContextSnapshot(this);
  }

  createLoopConfig(options: { skipInitialSteeringPoll?: boolean } = {}): AgentLoopConfig {
    return do_createLoopConfig(this, options);
  }

  async runWithLifecycle(executor: (signal: AbortSignal) => Promise<void>): Promise<void> {
    return do_runWithLifecycle(this, executor);
  }

  async handleRunFailure(error: unknown, aborted: boolean): Promise<void> {
    return do_handleRunFailure(this, error, aborted);
  }

  finishRun(): void {
    do_finishRun(this);
  }

  async processEvents(event: AgentEvent): Promise<void> {
    return do_processEvents(this, event);
  }
}
