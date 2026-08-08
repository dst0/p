import { type AssistantMessage, EventStream, validateToolArguments } from "@dst0/p-ai";
import { type CompletionMode, createFinishWorkTool, FINISH_WORK_TOOL_NAME } from "../completion-protocol.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool, AgentToolCall } from "../types.ts";
import {
  DEFAULT_COMPLETION_MODE,
  DEFAULT_MAX_CONSECUTIVE_WAITING_TURNS,
  DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES,
  DEFAULT_MAX_MALFORMED_TOOL_RETRIES,
  DEFAULT_MAX_MISSING_FINISH_RETRIES,
  DEFAULT_MAX_NO_PROGRESS_TURNS,
  DEFAULT_MAX_TURNS,
  EMPTY_USAGE,
} from "./constants.ts";
import type { AgentEventSink, CompletionProtocolLimits, CompletionProtocolState } from "./types.ts";

export function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );
}

export function resolveCompletionMode(config: AgentLoopConfig): CompletionMode {
  return config.completionMode ?? DEFAULT_COMPLETION_MODE;
}

export function createCompletionProtocolState(): CompletionProtocolState {
  return {
    turns: 0,
    noProgressTurns: 0,
    consecutiveWaitingTurns: 0,
    malformedToolRetries: 0,
    emptyAssistantRetries: 0,
    missingFinishRetries: 0,
    allowImplicitCompletion: false,
  };
}

export function isCompletionProtocolEnabled(mode: CompletionMode): boolean {
  return mode === "explicit_finish" || mode === "hybrid";
}

export function withCompletionProtocolTools(context: AgentContext, mode: CompletionMode): AgentContext {
  if (!isCompletionProtocolEnabled(mode)) {
    return context;
  }
  const tools = context.tools ?? [];
  return {
    ...context,
    tools: [...tools.filter((tool) => tool.name !== FINISH_WORK_TOOL_NAME), createFinishWorkTool()],
  };
}

export function resolveCompletionLimits(config: AgentLoopConfig, mode: CompletionMode): CompletionProtocolLimits {
  const explicitFinishDefault = mode === "explicit_finish" ? Number.POSITIVE_INFINITY : undefined;
  return {
    maxTurns: config.completionLimits?.maxTurns ?? explicitFinishDefault ?? DEFAULT_MAX_TURNS,
    maxNoProgressTurns:
      config.completionLimits?.maxNoProgressTurns ?? explicitFinishDefault ?? DEFAULT_MAX_NO_PROGRESS_TURNS,
    maxConsecutiveWaitingTurns:
      config.completionLimits?.maxConsecutiveWaitingTurns ?? DEFAULT_MAX_CONSECUTIVE_WAITING_TURNS,
    maxMalformedToolRetries: config.completionLimits?.maxMalformedToolRetries ?? DEFAULT_MAX_MALFORMED_TOOL_RETRIES,
    maxEmptyAssistantRetries: config.completionLimits?.maxEmptyAssistantRetries ?? DEFAULT_MAX_EMPTY_ASSISTANT_RETRIES,
    maxMissingFinishRetries:
      config.completionLimits?.maxMissingFinishRetries ?? explicitFinishDefault ?? DEFAULT_MAX_MISSING_FINISH_RETRIES,
  };
}

export function createProtocolFailureMessage(config: AgentLoopConfig, diagnostic: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: diagnostic }],
    api: config.model.api,
    provider: config.model.provider,
    model: config.model.id,
    usage: EMPTY_USAGE,
    stopReason: "error",
    errorMessage: diagnostic,
    timestamp: Date.now(),
  };
}

export async function emitProtocolFailure(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  emit: AgentEventSink,
  mode: CompletionMode,
  event: "max_turns_without_finish_work" | "no_progress_stop" | "waiting_loop_stop",
  diagnostic: string,
  turnAlreadyStarted: boolean,
): Promise<void> {
  await emit({ type: "completion_protocol", completionMode: mode, event, reason: diagnostic });
  if (!turnAlreadyStarted) {
    await emit({ type: "turn_start" });
  }
  const message = createProtocolFailureMessage(config, diagnostic);
  currentContext.messages.push(message);
  newMessages.push(message);
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
  await emit({ type: "turn_end", message, toolResults: [] });
  await emit({ type: "agent_end", messages: newMessages });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function sanitizeToolCallIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 48) || "tool";
}

export function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  return {
    ...toolCall,
    arguments: preparedArguments as Record<string, any>,
  };
}

export function createValidatedWaitCheckToolCall(
  waitToolCall: AgentToolCall,
  tools: AgentTool[] | undefined,
): AgentToolCall | undefined {
  const check = isRecord(waitToolCall.arguments.check) ? waitToolCall.arguments.check : undefined;
  const name = getStringValue(check?.tool);
  const args = isRecord(check?.arguments) ? check.arguments : undefined;
  if (!name || !args || name === "sleep" || name === FINISH_WORK_TOOL_NAME) {
    return undefined;
  }
  const tool = tools?.find((candidate) => candidate.name === name);
  if (!tool) {
    return undefined;
  }
  const toolCall: AgentToolCall = {
    type: "toolCall",
    id: `wait_check_${sanitizeToolCallIdSegment(waitToolCall.id)}`,
    name,
    arguments: args,
  };
  try {
    validateToolArguments(tool, prepareToolCallArguments(tool, toolCall));
  } catch {
    return undefined;
  }
  return toolCall;
}

export function expandWaitCheckToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AssistantMessage {
  const expandedContent: AssistantMessage["content"] = [];
  let expanded = false;
  for (const block of message.content) {
    expandedContent.push(block);
    if (block.type !== "toolCall" || block.name !== "sleep") {
      continue;
    }
    const checkToolCall = createValidatedWaitCheckToolCall(block, tools);
    if (!checkToolCall) {
      continue;
    }
    expandedContent.push(checkToolCall);
    expanded = true;
  }
  return expanded ? { ...message, content: expandedContent } : message;
}

export function stripMarkdownCodeFences(value: string): string {
  const lines = value.split(/\r?\n/);
  let activeFence: string | undefined;
  return lines
    .map((line) => {
      const fenceMatch = line.match(/^\s*(```+|~~~+)/);
      if (fenceMatch) {
        const fence = fenceMatch[1][0];
        if (!activeFence) {
          activeFence = fence;
        } else if (activeFence === fence) {
          activeFence = undefined;
        }
        return "";
      }
      return activeFence ? "" : line;
    })
    .join("\n");
}

export function normalizeMisplacedToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return {};
  }
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    return {};
  }
  return {};
}
