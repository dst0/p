import type { ChildProcess } from "node:child_process";
import type { AgentEvent, AgentMessage, ThinkingLevel } from "@dst0/p-agent-core";
import type { ImageContent } from "@dst0/p-ai";
import type { SessionStats } from "../../../core/agent-session.ts";
import type { BashResult } from "../../../core/bash-executor.ts";
import type { CompactionResult } from "../../../core/compaction/index.ts";
import type { RpcResponse, RpcSessionState, RpcSlashCommand } from "../rpc-types.ts";
import {
  do_abort,
  do_cycleModel,
  do_cycleThinkingLevel,
  do_followUp,
  do_getAvailableModels,
  do_getState,
  do_getStderr,
  do_newSession,
  do_onEvent,
  do_prompt,
  do_setModel,
  do_setSteeringMode,
  do_setThinkingLevel,
  do_start,
  do_steer,
  do_stop,
} from "./rpcclient-methods/methods-part1.ts";
import {
  do_abortBash,
  do_abortRetry,
  do_bash,
  do_clone,
  do_collectEvents,
  do_compact,
  do_createProcessExitError,
  do_exportHtml,
  do_fork,
  do_getCommands,
  do_getForkMessages,
  do_getLastAssistantText,
  do_getMessages,
  do_getSessionStats,
  do_handleLine,
  do_promptAndWait,
  do_rejectPendingRequests,
  do_setAutoCompaction,
  do_setAutoRetry,
  do_setFollowUpMode,
  do_setSessionName,
  do_switchSession,
  do_waitForIdle,
} from "./rpcclient-methods/methods-part2.ts";
import { do_getData, do_send } from "./rpcclient-methods/methods-part3.ts";
import type { ModelInfo, RpcClientOptions, RpcCommandBody, RpcEventListener } from "./types.ts";

export class RpcClient {
  public process: ChildProcess | null = null;

  public stopReadingStdout: (() => void) | null = null;

  public eventListeners: RpcEventListener[] = [];

  public pendingRequests: Map<string, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }> =
    new Map();

  public requestId = 0;

  public stderr = "";

  public exitError: Error | null = null;

  public options: RpcClientOptions;

  constructor(options: RpcClientOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    return do_start(this);
  }

  async stop(): Promise<void> {
    return do_stop(this);
  }

  onEvent(listener: RpcEventListener): () => void {
    return do_onEvent(this, listener);
  }

  getStderr(): string {
    return do_getStderr(this);
  }

  async prompt(message: string, images?: ImageContent[]): Promise<void> {
    return do_prompt(this, message, images);
  }

  async steer(message: string, images?: ImageContent[]): Promise<void> {
    return do_steer(this, message, images);
  }

  async followUp(message: string, images?: ImageContent[]): Promise<void> {
    return do_followUp(this, message, images);
  }

  async abort(): Promise<void> {
    return do_abort(this);
  }

  async newSession(parentSession?: string): Promise<{ cancelled: boolean }> {
    return do_newSession(this, parentSession);
  }

  async getState(): Promise<RpcSessionState> {
    return do_getState(this);
  }

  async setModel(provider: string, modelId: string): Promise<{ provider: string; id: string }> {
    return do_setModel(this, provider, modelId);
  }

  async cycleModel(): Promise<{
    model: { provider: string; id: string };
    thinkingLevel: ThinkingLevel;
    isScoped: boolean;
  } | null> {
    return do_cycleModel(this);
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    return do_getAvailableModels(this);
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    return do_setThinkingLevel(this, level);
  }

  async cycleThinkingLevel(): Promise<{ level: ThinkingLevel } | null> {
    return do_cycleThinkingLevel(this);
  }

  async setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return do_setSteeringMode(this, mode);
  }

  async setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void> {
    return do_setFollowUpMode(this, mode);
  }

  async compact(customInstructions?: string): Promise<CompactionResult> {
    return do_compact(this, customInstructions);
  }

  async setAutoCompaction(enabled: boolean): Promise<void> {
    return do_setAutoCompaction(this, enabled);
  }

  async setAutoRetry(enabled: boolean): Promise<void> {
    return do_setAutoRetry(this, enabled);
  }

  async abortRetry(): Promise<void> {
    return do_abortRetry(this);
  }

  async bash(command: string): Promise<BashResult> {
    return do_bash(this, command);
  }

  async abortBash(): Promise<void> {
    return do_abortBash(this);
  }

  async getSessionStats(): Promise<SessionStats> {
    return do_getSessionStats(this);
  }

  async exportHtml(outputPath?: string): Promise<{ path: string }> {
    return do_exportHtml(this, outputPath);
  }

  async switchSession(sessionPath: string): Promise<{ cancelled: boolean }> {
    return do_switchSession(this, sessionPath);
  }

  async fork(entryId: string): Promise<{ text: string; cancelled: boolean }> {
    return do_fork(this, entryId);
  }

  async clone(): Promise<{ cancelled: boolean }> {
    return do_clone(this);
  }

  async getForkMessages(): Promise<Array<{ entryId: string; text: string }>> {
    return do_getForkMessages(this);
  }

  async getLastAssistantText(): Promise<string | null> {
    return do_getLastAssistantText(this);
  }

  async setSessionName(name: string): Promise<void> {
    return do_setSessionName(this, name);
  }

  async getMessages(): Promise<AgentMessage[]> {
    return do_getMessages(this);
  }

  async getCommands(): Promise<RpcSlashCommand[]> {
    return do_getCommands(this);
  }

  waitForIdle(timeout = 60000): Promise<void> {
    return do_waitForIdle(this, timeout);
  }

  collectEvents(timeout = 60000): Promise<AgentEvent[]> {
    return do_collectEvents(this, timeout);
  }

  async promptAndWait(message: string, images?: ImageContent[], timeout = 60000): Promise<AgentEvent[]> {
    return do_promptAndWait(this, message, images, timeout);
  }

  handleLine(line: string): void {
    do_handleLine(this, line);
  }

  createProcessExitError(code: number | null, signal: NodeJS.Signals | null): Error {
    return do_createProcessExitError(this, code, signal);
  }

  rejectPendingRequests(error: Error): void {
    do_rejectPendingRequests(this, error);
  }

  async send(command: RpcCommandBody): Promise<RpcResponse> {
    return do_send(this, command);
  }

  getData<T>(response: RpcResponse): T {
    return do_getData(this, response);
  }
}
