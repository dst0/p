import type { ToolResultMessage } from "@dst0/p-ai";
import type { FinishWorkPayload } from "../completion-protocol.ts";
import type { ResolvedToolEffect } from "../tool-effects.ts";
import type { AgentEvent, AgentLoopConfig, AgentTool, AgentToolCall, AgentToolResult } from "../types.ts";

export type AgentEventSink = (event: AgentEvent) => Promise<void> | void;

export type CompletionProtocolState = {
  turns: number;
  noProgressTurns: number;
  consecutiveWaitingTurns: number;
  malformedToolRetries: number;
  emptyAssistantRetries: number;
  missingFinishRetries: number;
  allowImplicitCompletion: boolean;
};

export type CompletionProtocolLimits = Required<NonNullable<AgentLoopConfig["completionLimits"]>>;

export type CompletionProtocolRepair = {
  reason:
    | "malformed_or_truncated_tool_call"
    | "missing_finish_work_or_tool_call"
    | "mixed_finish_work_tool_call"
    | "repetitive_model_output";
  message: string;
  event: "malformed_tool_call_retry" | "missing_finish_work_retry";
};

export interface ParsedMisplacedToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type ExecutedToolCallBatch = {
  messages: ToolResultMessage[];
  terminate: boolean;
  madeProgress: boolean;
  waiting: boolean;
  completion?: FinishWorkPayload;
};

export type PreparedToolCall = {
  kind: "prepared";
  toolCall: AgentToolCall;
  tool: AgentTool<any>;
  args: unknown;
  effect: ResolvedToolEffect;
};

export type ImmediateToolCallOutcome = {
  kind: "immediate";
  result: AgentToolResult<any>;
  isError: boolean;
};

export type ExecutedToolCallOutcome = {
  result: AgentToolResult<any>;
  isError: boolean;
};

export type FinalizedToolCallOutcome = {
  toolCall: AgentToolCall;
  result: AgentToolResult<any>;
  isError: boolean;
  executed: boolean;
};

export type FinalizedToolCallEntry = FinalizedToolCallOutcome | (() => Promise<FinalizedToolCallOutcome>);
